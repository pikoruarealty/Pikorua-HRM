import { AttendanceApprovalStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { computeHours, getDefaultClockOut } from "@/lib/attendance/time";
import { summariseSessions } from "@/lib/attendance/sessions";
import { audit, clientIp } from "@/lib/audit";

// Track A. PATCH /api/v1/attendance/:id/approve — Admin/HR. If not
// separately edited first (via .../edit), approved times default to the raw
// values. If clock-out is missing, defaults to standard shift end time (20:00 or
// expectedStartTime + 9h). Recomputes total_hours/is_half_day from the final approved
// times, since those are what payroll reads.
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

  const existing = await prisma.attendanceRecord.findUnique({
    where: { id: params.id },
    include: {
      sessions: { select: { clockIn: true, clockOut: true } },
      employee: {
        select: {
          id: true,
          team: { select: { expectedStartTime: true } },
        },
      },
    },
  });
  if (!existing) {
    return failFor(ErrorCode.NOT_FOUND, "Attendance record not found.");
  }

  const clockInApproved = existing.clockInApproved ?? existing.clockInRaw;
  if (!clockInApproved) {
    return fail(
      ErrorCode.VALIDATION,
      "Cannot approve: record has no clock-in time.",
      422,
    );
  }

  const clockOutApproved =
    existing.clockOutApproved ??
    existing.clockOutRaw ??
    getDefaultClockOut(clockInApproved, existing.employee?.team?.expectedStartTime ?? "11:00");

  // Hours come from the day's sessions when it has them — a day can be several
  // stretches of work with breaks between (2026-08-11), and approved-out minus
  // approved-in would pay those breaks. Approved times still win if Admin/HR
  // edited them by hand (PATCH .../edit), which leaves total_hours already set
  // from those times; here we only recompute for the untouched case.
  const editedByHand = existing.clockInApproved !== null || existing.clockOutApproved !== null;
  const closedSessions = existing.sessions.filter((s) => s.clockOut !== null);
  const { totalHours, isHalfDay } =
    !editedByHand && closedSessions.length > 0
      ? summariseSessions(closedSessions)
      : computeHours(clockInApproved, clockOutApproved);

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
