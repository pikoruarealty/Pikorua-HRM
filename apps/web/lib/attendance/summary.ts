import { AttendanceApprovalStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { isLateArrival } from "@/lib/attendance/time";
import { getApprovedUnpaidLeaveDays } from "@/lib/requests/leave";
import { NotImplementedError } from "@/lib/errors";

// Track A. Shared approved-only attendance summary computation — used by both
// GET /api/v1/attendance/:employee_id/summary and payroll's payslip
// generation (Milestone 3), so the two never drift out of sync on what
// counts as "late"/"half-day"/"unpaid leave" for a period.

export type AttendanceSummary = {
  lateCount: number;
  halfDayCount: number;
  unpaidLeaveCount: number | null;
  approvedRecordCount: number;
  lateTrackingUnavailable: boolean;
  unpaidLeaveUnavailable: boolean;
};

/** employee must already be known to exist; month is 1-12. `lateGraceMinutes`
 *  is the period-effective PayrollConfig grace window (default 0). */
export async function getAttendanceSummary(
  employeeId: string,
  month: number,
  year: number,
  lateGraceMinutes = 0,
): Promise<AttendanceSummary> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { team: { select: { expectedStartTime: true } } },
  });

  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(year, month, 1)); // exclusive

  const records = await prisma.attendanceRecord.findMany({
    where: {
      employeeId,
      approvalStatus: AttendanceApprovalStatus.approved,
      date: { gte: periodStart, lt: periodEnd },
    },
  });

  const expectedStartTime = employee?.team?.expectedStartTime ?? null;
  let lateCount = 0;
  let halfDayCount = 0;
  let lateTrackingUnavailable = false;

  for (const r of records) {
    if (r.isHalfDay) halfDayCount += 1;
    if (!expectedStartTime) {
      lateTrackingUnavailable = true;
      continue;
    }
    if (r.clockInApproved && isLateArrival(r.clockInApproved, expectedStartTime, lateGraceMinutes)) {
      lateCount += 1;
    }
  }

  let unpaidLeaveCount: number | null = null;
  let unpaidLeaveUnavailable = false;
  try {
    unpaidLeaveCount = await getApprovedUnpaidLeaveDays(employeeId, month, year);
  } catch (err) {
    if (err instanceof NotImplementedError) {
      unpaidLeaveUnavailable = true;
    } else {
      throw err;
    }
  }

  return {
    lateCount,
    halfDayCount,
    unpaidLeaveCount,
    approvedRecordCount: records.length,
    lateTrackingUnavailable,
    unpaidLeaveUnavailable,
  };
}
