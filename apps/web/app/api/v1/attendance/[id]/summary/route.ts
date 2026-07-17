import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { getAttendanceSummary } from "@/lib/attendance/summary";
import { getMonthlyAttendanceBreakdown } from "@/lib/attendance/monthly-breakdown";

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
  let isOwnTeamLead = false;
  if (!isFinance && !isSelf && isLeadRole(session.role) && session.employeeId) {
    const [lead, target] = await Promise.all([
      prisma.employee.findUnique({ where: { id: session.employeeId }, select: { teamId: true } }),
      prisma.employee.findUnique({ where: { id: employeeId }, select: { teamId: true } }),
    ]);
    isOwnTeamLead = !!lead?.teamId && lead.teamId === target?.teamId;
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
    select: { id: true },
  });
  if (!employee) {
    return failFor(ErrorCode.NOT_FOUND, "Employee not found.");
  }

  const [summary, breakdown] = await Promise.all([
    getAttendanceSummary(employeeId, month, year),
    getMonthlyAttendanceBreakdown(employeeId, month, year),
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
