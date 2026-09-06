import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, Role } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { audit, clientIp } from "@/lib/audit";
import { AttendanceApprovalStatus } from "@prisma/client";

// Track A. DELETE /api/v1/attendance/:id — Admin/HR only for the narrow
// (phantom/incomplete) path; Admin-only for the broader override path.
//
// Default behavior unchanged: cleanup of phantom/incomplete records (e.g.
// created by employee-creation side effects or test data) that have no
// clock-in and no clock-out. Records with approved times or any clock data
// are blocked here.
//
// Admin override (2026-09-06, owner request): passing a JSON body
// { admin_override: true, reason: "..." } as Role.admin bypasses both guards
// and permanently deletes any attendance record, including approved history
// payroll may already depend on. Distinctly audited with the reason and an
// admin_override marker so it's easy to distinguish from routine cleanup in
// the audit log.
const overrideSchema = z.object({
  admin_override: z.literal(true),
  reason: z.string().min(3, "A reason is required to force-delete an attendance record."),
});

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!FINANCE_ROLES.includes(session.role)) return failFor(ErrorCode.FORBIDDEN);

  let override: { admin_override: true; reason: string } | null = null;
  const rawBody = await req.text();
  if (rawBody) {
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
    }
    const parsed = overrideSchema.safeParse(body);
    if (parsed.success) {
      if (session.role !== Role.admin) return failFor(ErrorCode.FORBIDDEN, "Only Admin can force-delete an attendance record.");
      override = parsed.data;
    } else if (body && typeof body === "object" && Object.keys(body).length > 0) {
      return failFor(ErrorCode.VALIDATION, parsed.error.issues[0]?.message ?? "Invalid request body.");
    }
  }

  try {
    const record = await prisma.attendanceRecord.findUnique({ where: { id: params.id } });
    if (!record) return failFor(ErrorCode.NOT_FOUND, "Attendance record not found.");

    if (!override) {
      // This route is strictly for cleaning up phantom/incomplete records — a
      // record that was ever clocked or has already been approved is real
      // attendance history payroll may depend on, so it's out of scope here.
      if (record.approvalStatus === AttendanceApprovalStatus.approved) {
        return failFor(
          ErrorCode.CONFLICT,
          "Cannot delete an approved attendance record. Unapprove it first, or use the Admin force-delete option.",
        );
      }
      if (record.clockInRaw || record.clockOutRaw) {
        return failFor(
          ErrorCode.CONFLICT,
          "Cannot delete an attendance record that has clock-in or clock-out data. This route is only for phantom/incomplete records.",
        );
      }
    }

    await prisma.attendanceRecord.delete({ where: { id: params.id } });

    await audit({
      action: "attendance.delete",
      actorUserId: session.userId,
      actorRole: session.role,
      entityType: "attendance_record",
      entityId: params.id,
      metadata: {
        employee_id: record.employeeId,
        date: record.date.toISOString().slice(0, 10),
        clock_in: (record.clockInApproved ?? record.clockInRaw)?.toISOString() ?? null,
        clock_out: (record.clockOutApproved ?? record.clockOutRaw)?.toISOString() ?? null,
        approval_status: record.approvalStatus,
        reason: override ? override.reason : "attendance_record_cleanup",
        admin_override: !!override,
      },
      ip: clientIp(req),
    });

    return ok({ deleted: true });
  } catch (err) {
    console.error("[attendance DELETE] unexpected error:", err);
    return failFor(ErrorCode.INTERNAL, "Failed to delete attendance record. Check server logs.");
  }
}
