import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { audit, clientIp } from "@/lib/audit";

// Track A. DELETE /api/v1/attendance/:id — Admin/HR only.
// Permanent removal of a single attendance record. Intended strictly for
// cleanup of phantom/incomplete records (e.g. created by employee-creation
// side effects or test data) that have no clock-in and no clock-out.
// Records with approved times are blocked from deletion here — use the
// soft-deactivate path or contact the DB admin for those.
export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!FINANCE_ROLES.includes(session.role)) return failFor(ErrorCode.FORBIDDEN);

  try {
    const record = await prisma.attendanceRecord.findUnique({ where: { id: params.id } });
    if (!record) return failFor(ErrorCode.NOT_FOUND, "Attendance record not found.");

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
        reason: "attendance_record_cleanup",
      },
      ip: clientIp(req),
    });

    return ok({ deleted: true });
  } catch (err) {
    console.error("[attendance DELETE] unexpected error:", err);
    return failFor(ErrorCode.INTERNAL, "Failed to delete attendance record. Check server logs.");
  }
}
