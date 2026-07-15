import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { Role } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { computeHours } from "@/lib/attendance/time";
import { AttendanceApprovalStatus, AttendanceSource } from "@prisma/client";
import { audit, clientIp } from "@/lib/audit";

// Admin manual override (2026-07-15). POST /api/v1/attendance/manual —
// **Admin only**: create (or overwrite the approved times of) an attendance
// record for any employee/date — e.g. someone who couldn't log in at all
// that day. The record is written pre-approved (approved times + approver
// stamp) since an admin entering it by hand IS the approval. Raw clock
// values are never touched — if the employee did clock something, it stays
// for audit.

const manualSchema = z.object({
  employee_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  clock_in: z.string().datetime(),
  clock_out: z.string().datetime().optional(),
  reason: z.string().min(3, "A reason is required for a manual record."),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (session.role !== Role.admin) return failFor(ErrorCode.FORBIDDEN);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
  }
  const parsed = manualSchema.safeParse(body);
  if (!parsed.success) {
    return failFor(ErrorCode.VALIDATION, parsed.error.issues[0]?.message ?? "Invalid manual record.");
  }
  const d = parsed.data;

  const employee = await prisma.employee.findUnique({ where: { id: d.employee_id } });
  if (!employee) return failFor(ErrorCode.VALIDATION, "employee_id does not reference an existing employee.");

  const date = new Date(`${d.date}T00:00:00.000Z`);
  const clockIn = new Date(d.clock_in);
  const clockOut = d.clock_out ? new Date(d.clock_out) : null;
  if (clockOut && clockOut <= clockIn) {
    return failFor(ErrorCode.VALIDATION, "clock_out must be after clock_in.");
  }

  const hours = clockOut ? computeHours(clockIn, clockOut) : null;
  const existing = await prisma.attendanceRecord.findUnique({
    where: { employeeId_date: { employeeId: d.employee_id, date } },
  });

  const data = {
    clockInApproved: clockIn,
    clockOutApproved: clockOut,
    ...(hours ? { totalHours: hours.totalHours, isHalfDay: hours.isHalfDay } : {}),
    approvalStatus: AttendanceApprovalStatus.approved,
    approvedById: session.userId,
    approvedAt: new Date(),
    source: AttendanceSource.manual,
  };

  const record = existing
    ? await prisma.attendanceRecord.update({ where: { id: existing.id }, data })
    : await prisma.attendanceRecord.create({
        data: { employeeId: d.employee_id, date, ...data },
      });

  await audit({
    action: existing ? "attendance.manual_override" : "attendance.manual_create",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "attendance_record",
    entityId: record.id,
    metadata: {
      employee_id: d.employee_id,
      date: d.date,
      clock_in: clockIn.toISOString(),
      clock_out: clockOut?.toISOString() ?? null,
      reason: d.reason,
      ...(existing
        ? {
            clock_in_before: (existing.clockInApproved ?? existing.clockInRaw)?.toISOString() ?? null,
            clock_out_before: (existing.clockOutApproved ?? existing.clockOutRaw)?.toISOString() ?? null,
          }
        : {}),
    },
    ip: clientIp(req),
  });

  return ok(record, existing ? 200 : 201);
}
