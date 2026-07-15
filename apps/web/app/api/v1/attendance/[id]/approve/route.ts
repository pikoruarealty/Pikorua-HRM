import { AttendanceApprovalStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { computeHours } from "@/lib/attendance/time";
import { audit, clientIp } from "@/lib/audit";

// Track A. PATCH /api/v1/attendance/:id/approve — Admin/HR. If not
// separately edited first (via .../edit), approved times default to the raw
// values. Recomputes total_hours/is_half_day from the final approved times,
// since those are what payroll reads. Requires both a clock-in and
// clock-out to exist (raw or already-approved) — an incomplete record can't
// be meaningfully approved.
export async function PATCH(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  if (!session) {
    return failFor(ErrorCode.UNAUTHENTICATED);
  }
  if (!FINANCE_ROLES.includes(session.role)) {
    return failFor(ErrorCode.FORBIDDEN);
  }

  const existing = await prisma.attendanceRecord.findUnique({ where: { id: params.id } });
  if (!existing) {
    return failFor(ErrorCode.NOT_FOUND, "Attendance record not found.");
  }

  const clockInApproved = existing.clockInApproved ?? existing.clockInRaw;
  const clockOutApproved = existing.clockOutApproved ?? existing.clockOutRaw;

  if (!clockInApproved || !clockOutApproved) {
    return fail(
      ErrorCode.VALIDATION,
      "Cannot approve: record is missing a clock-in and/or clock-out time.",
      422,
    );
  }

  const { totalHours, isHalfDay } = computeHours(clockInApproved, clockOutApproved);

  const updated = await prisma.attendanceRecord.update({
    where: { id: params.id },
    data: {
      clockInApproved,
      clockOutApproved,
      totalHours,
      isHalfDay,
      approvalStatus: AttendanceApprovalStatus.approved,
      approvedById: session.userId,
      approvedAt: new Date(),
    },
  });

  await audit({
    action: "attendance.approve",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "attendance_record",
    entityId: params.id,
    metadata: { employee_id: existing.employeeId, total_hours: totalHours, is_half_day: isHalfDay },
    ip: clientIp(_req),
  });

  return ok(updated);
}
