import { EmploymentType } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getEffectiveLeaveConfig } from "@/lib/leave/config";
import { getApprovedPaidLeaveDays, getApprovedPaidLeaveDaysForYear } from "@/lib/requests/leave";
import { getCompensationDaysInRange } from "@/lib/attendance/monthly-breakdown";
import { periodBounds, yearBounds } from "@/lib/requests/leave-math";

// Leave balance (2026-08-07, owner request). Combines the admin-configured
// allowance with actual usage to show an employee "used X, Y remaining" for
// both the current month and the current year.
//
// Compensation credit: a compensation day (Sunday clock-in, or an admin
// manually flagging a weekday record — see monthly-breakdown.ts) ADDS BACK
// to remaining, on the idea that coming in to compensate for a leave earns
// that leave day back. remaining = allowance - used + compensated, floored
// at 0. This is a reasonable reading of "when compensated the leave
// counters should go up," not a stakeholder-confirmed formula — flag if the
// intended relationship is different (e.g. compensation should only offset
// unpaid leave, not add on top of the paid allowance).
export type LeaveBalance = {
  month: { allowance: number; used: number; compensated: number; remaining: number };
  year: { allowance: number; used: number; compensated: number; remaining: number };
};

// Tenure proration (2026-08-08, owner request): a joiner mid-year hasn't
// accrued a full year's allowance — scale the configured annual allowance by
// the fraction of the year actually worked, counted in whole months from the
// joining month (inclusive) through December, rounded to the nearest half
// day. Employees who joined in a prior year get the full allowance; an
// employee queried for a year before they joined gets 0 (they didn't exist
// on the books yet).
function proratedAnnualAllowance(annual: number, dateOfJoining: Date, year: number): number {
  const joinYear = dateOfJoining.getUTCFullYear();
  if (joinYear > year) return 0;
  if (joinYear < year) return annual;
  const joinMonth = dateOfJoining.getUTCMonth() + 1; // 1-12
  const monthsWorked = 12 - joinMonth + 1;
  return Math.round(((annual * monthsWorked) / 12) * 2) / 2;
}

export async function getLeaveBalance(
  employeeId: string,
  month: number,
  year: number,
  dateOfJoining?: Date,
  employmentType?: EmploymentType,
): Promise<LeaveBalance> {
  const config = await getEffectiveLeaveConfig(month, year);
  const empType =
    employmentType ??
    (
      await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { employmentType: true },
      })
    )?.employmentType ??
    EmploymentType.fulltime;

  // Before the employee's joining month/year, they hadn't accrued anything.
  const beforeJoining =
    dateOfJoining &&
    (year < dateOfJoining.getUTCFullYear() ||
      (year === dateOfJoining.getUTCFullYear() && month < dateOfJoining.getUTCMonth() + 1));

  let rawMonth = config?.paidLeavesPerMonth ?? 0;
  let rawYear = config?.paidLeavesPerYear ?? 0;

  if (empType === EmploymentType.parttime) {
    rawMonth = config?.partTimePaidLeavesPerMonth ?? config?.paidLeavesPerMonth ?? 0;
    rawYear = config?.partTimePaidLeavesPerYear ?? config?.paidLeavesPerYear ?? 0;
  } else if (empType === EmploymentType.intern) {
    rawMonth = config?.internPaidLeavesPerMonth ?? config?.paidLeavesPerMonth ?? 0;
    rawYear = config?.internPaidLeavesPerYear ?? config?.paidLeavesPerYear ?? 0;
  }

  const allowanceMonth = beforeJoining ? 0 : rawMonth;
  const allowanceYear = dateOfJoining
    ? proratedAnnualAllowance(rawYear, dateOfJoining, year)
    : rawYear;

  const { start: monthStart, lastDay: monthEnd } = periodBounds(month, year);
  const { start: yearStart, lastDay: yearEnd } = yearBounds(year);

  const [usedMonth, usedYear, compensatedMonth, compensatedYear] = await Promise.all([
    getApprovedPaidLeaveDays(employeeId, month, year),
    getApprovedPaidLeaveDaysForYear(employeeId, year),
    getCompensationDaysInRange(employeeId, monthStart, monthEnd),
    getCompensationDaysInRange(employeeId, yearStart, yearEnd),
  ]);

  return {
    month: {
      allowance: allowanceMonth,
      used: usedMonth,
      compensated: compensatedMonth,
      remaining: Math.max(0, allowanceMonth - usedMonth + compensatedMonth),
    },
    year: {
      allowance: allowanceYear,
      used: usedYear,
      compensated: compensatedYear,
      remaining: Math.max(0, allowanceYear - usedYear + compensatedYear),
    },
  };
}
