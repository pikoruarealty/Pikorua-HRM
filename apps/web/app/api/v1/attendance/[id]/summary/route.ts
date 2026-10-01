import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { getAttendanceSummary } from "@/lib/attendance/summary";
import { getMonthlyAttendanceBreakdown } from "@/lib/attendance/monthly-breakdown";
import { getEffectivePayrollConfig } from "@/lib/payroll/config";
import { getLedEmployeeIds } from "@/lib/employees/managed-scope";
import { getEmployeeAttendanceCalendar } from "@/lib/attendance/calendar";
import { getExpectedHoursForMonth } from "@/lib/attendance/expected-hours";
import { ATTENDANCE_EXEMPT_MESSAGE, isAttendanceExemptRole } from "@/lib/attendance/tracking";

// Track A. GET /api/v1/attendance/:employee_id/summary?month=&year=
// (folder is named [id], not [employee_id], only because Next.js requires
// one dynamic-segment name per path level and .../[id]/edit + .../[id]/approve
// use the attendance *record* id at the same level — the URL shape and
// semantics still match API_SPEC.md exactly: this segment is an employee id.)
// Admin/HR (any), Lead (own team only), Employee (self only). Computed from
// **approved-only** attendance records — this is the exact feed payroll
// (Milestone 3) reads too, via lib/attendance/summary.ts.
const querySchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
});

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const employeeId = params.id;
  const session = await getSession();
  if (!session) {
    return failFor(ErrorCode.UNAUTHENTICATED);
  }

  const isFinance = FINANCE_ROLES.includes(session.role);
  const isSelf = session.employeeId === employeeId;
  // "Own team" means every team this Lead leads, not the one they belong to.
  let isOwnTeamLead = false;
  if (!isFinance && !isSelf && isLeadRole(session.role) && session.employeeId) {
    const ledIds = await getLedEmployeeIds(session.employeeId);
    isOwnTeamLead = ledIds.includes(employeeId);
  }
  if (!isFinance && !isSelf && !isOwnTeamLead) {
    return failFor(ErrorCode.FORBIDDEN);
  }

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse({
    month: searchParams.get("month"),
    year: searchParams.get("year"),
  });
  if (!parsed.success) {
    return failFor(ErrorCode.VALIDATION, "month (1-12) and year are required query params.");
  }
  const { month, year } = parsed.data;

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, role: true },
  });
  if (!employee) {
    return failFor(ErrorCode.NOT_FOUND, "Employee not found.");
  }
  if (isAttendanceExemptRole(employee.role)) {
    return failFor(ErrorCode.NOT_FOUND, ATTENDANCE_EXEMPT_MESSAGE);
  }

  const effectiveConfig = await getEffectivePayrollConfig(month, year);
  const [summary, breakdown] = await Promise.all([
    getAttendanceSummary(employeeId, month, year, effectiveConfig?.lateGraceMinutes ?? 0),
    getMonthlyAttendanceBreakdown(employeeId, month, year),
  ]);
  const [{ calendar }, expectedHours] = await Promise.all([
    getEmployeeAttendanceCalendar(employeeId, month, year, breakdown),
    getExpectedHoursForMonth(employeeId, month, year),
  ]);

  return ok({
    employee_id: employeeId,
    month,
    year,
    late_count: summary.lateCount,
    half_day_count: summary.halfDayCount,
    unpaid_leave_count: summary.unpaidLeaveCount,
    approved_record_count: summary.approvedRecordCount,
    // Reporting-only breakdown (2026-07-17) — present/absent/paid-leave/
    // compensation/holiday counts, derived independently of the payroll
    // deduction fields above (see lib/attendance/monthly-breakdown.ts).
    present_days: breakdown.presentDays,
    absent_days: breakdown.absentDays,
    half_days: breakdown.halfDays,
    paid_leave_days: breakdown.paidLeaveDays,
    unpaid_leave_days: breakdown.unpaidLeaveDays,
    compensation_days: breakdown.compensationDays,
    holiday_days: breakdown.holidayDays,
    working_days_elapsed: breakdown.workingDaysElapsed,
    // 2026-10-01 — the days that count toward pay (present + half×0.5 + paid leave +
    // holiday + compensation): the exact sum of the per-day `credit` in `days`, so
    // it can be checked against the calendar. Leave days can be fractional now
    // (half-day leave), as can absent for a part-timer's quota shortfall.
    payable_days: breakdown.payableDays,
    // 2026-09-30 — in-office vs work-from-home. Hours and the worked-day split
    // use approved days only (same basis as every count above); a day that has a
    // record but isn't approved yet is listed in `pending` and shows on the
    // calendar as pending rather than being silently absent.
    hours: calendar.hours,
    // Expected hours of work for the whole month (muted figure beside "hours
    // worked"): shift x expected working days for a fixed schedule, weekly
    // (days x shift + WFH target) x 4 for a part-timer.
    expected_hours: expectedHours,
    worked_days: calendar.workedDays,
    by_status: calendar.byStatus,
    pending: calendar.pending,
    // One entry per calendar day of the month — the same classification that
    // produced the counts above, plus the day's hours/times/location.
    days: calendar.days,
    notes: {
      late_tracking_unavailable: summary.lateTrackingUnavailable
        ? "This employee's team has no expected_start_time configured — late count excludes those days."
        : undefined,
      unpaid_leave_unavailable: summary.unpaidLeaveUnavailable
        ? "Track B has not implemented getApprovedUnpaidLeaveDays yet."
        : undefined,
    },
  });
}
