import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { getAttendanceSummary } from "@/lib/attendance/summary";
import { getMonthlyAttendanceBreakdown } from "@/lib/attendance/monthly-breakdown";
import { getEffectivePayrollConfig } from "@/lib/payroll/config";
import { getCompensationBalance } from "@/lib/attendance/compensation-credits";
import { getLedEmployeeIds } from "@/lib/employees/managed-scope";
import { getEmployeeAttendanceCalendar } from "@/lib/attendance/calendar";
import { getExpectedHoursForMonth } from "@/lib/attendance/expected-hours";
import { ATTENDANCE_EXEMPT_MESSAGE, isAttendanceExemptRole } from "@/lib/attendance/tracking";
import { isFixedSchedule } from "@/lib/attendance/weekly-off";
import { daysOwedOf } from "@/lib/attendance/report";

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
    select: { id: true, role: true, employmentType: true, requiredDaysPerWeek: true },
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
  const [{ calendar }, expectedHours, compensationBalance] = await Promise.all([
    getEmployeeAttendanceCalendar(employeeId, month, year, breakdown),
    getExpectedHoursForMonth(employeeId, month, year),
    getCompensationBalance(employeeId, month, year),
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
    // Extra days that made up an earlier missed day (paid, 2026-11-01 rule —
    // lib/attendance/extra-days.ts). Days worked in advance are in `present_days`
    // and counted separately; `banked_days` of them were banked and are NOT paid.
    compensation_days: breakdown.compensationDays,
    advance_days: breakdown.advanceDays,
    banked_days: breakdown.bankedDays,
    // A part-timer's days worked only from home (they go to the WFH hours, not the
    // in-office day quota) and half days over the quota — worked, not paid.
    wfh_only_days: breakdown.wfhOnlyDays,
    over_quota_half_days: breakdown.overQuotaHalfDays,
    unpaid_work_days: breakdown.unpaidWorkDays,
    // Of paid_leave_days: absent / unpaid days covered by an approved balance day.
    balance_days: breakdown.balanceDays,
    // Of absent_days / unpaid_leave_days: days a later extra day made up (paid on
    // that day, maybe next month) — so the tile doesn't read as an underpayment.
    made_up: {
      absent: breakdown.madeUp.filter((m) => m.missed.kind !== "unpaid_leave").length,
      unpaid: breakdown.madeUp.filter((m) => m.missed.kind === "unpaid_leave").length,
    },
    // A part-timer's days owed this month (weekly quotas; a holiday week owes less) —
    // what payable days are measured against. null for a fixed schedule.
    days_owed: isFixedSchedule(employee) ? null : daysOwedOf(breakdown),
    holiday_days: breakdown.holidayDays,
    working_days_elapsed: breakdown.workingDaysElapsed,
    // 2026-10-01 — the days that count toward pay ((present − banked) + half×0.5 +
    // paid leave + holiday + compensation): the exact sum of the per-day `credit` in `days`, so
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
    // Balance days (derived from the walk's ledger): each day worked in advance with
    // nothing earlier to make up banks one, usable on an absent / unpaid day for 60
    // days through an approved request; `madeUp` lists the automatic make-ups that
    // touch this month — see lib/attendance/extra-days.ts.
    compensation_balance: compensationBalance,
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
