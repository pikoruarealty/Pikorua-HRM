import { EmploymentType } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getEffectiveLeaveConfig } from "@/lib/leave/config";
import { getApprovedPaidLeaveDays, getApprovedPaidLeaveDaysForYear } from "@/lib/requests/leave";
import { getExpiredUnusedCreditCount } from "@/lib/attendance/compensation-credits";
import { periodBounds, yearBounds } from "@/lib/requests/leave-math";

// Leave balance (2026-08-07, owner request). Combines the admin-configured
// allowance with actual usage to show an employee "used X, Y remaining" for
// both the current month and the current year.
//
// Compensation credit (reworked 2026-09-18, owner request): a credit's whole
// job is to redeem a specific absent/unpaid-leave day within its 60-day
// window — see lib/attendance/compensation-credits.ts. It does NOT add to
// `remaining` the moment it's earned. Only once a credit expires having
// covered nothing at all does it convert into a paid-leave-balance day
// (getExpiredUnusedCreditCount) — "compensate for the absent days first,
// and only if there's nothing left to compensate, add to the leave
// balance." remaining = allowance - used + compensated, floored at 0, where
// `compensated` now counts only genuinely-unused, expired credits.
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

/** The raw (un-prorated, pre-joining-check) monthly/yearly paid-leave caps
 *  for an employee's employment type, from whichever LeaveConfig row is
 *  effective for the given month/year. Factored out of getLeaveBalance
 *  (2026-09-06) so the approve route's monthly-cap auto-overflow can look up
 *  the same caps without duplicating the employment-type branching. */
export async function getEffectivePaidLeaveCaps(
  employeeId: string,
  month: number,
  year: number,
  employmentType?: EmploymentType,
): Promise<{ monthlyCap: number; yearlyCap: number }> {
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

  if (empType === EmploymentType.parttime) {
    return {
      monthlyCap: config?.partTimePaidLeavesPerMonth ?? config?.paidLeavesPerMonth ?? 0,
      yearlyCap: config?.partTimePaidLeavesPerYear ?? config?.paidLeavesPerYear ?? 0,
    };
  }
  if (empType === EmploymentType.intern) {
    return {
      monthlyCap: config?.internPaidLeavesPerMonth ?? config?.paidLeavesPerMonth ?? 0,
      yearlyCap: config?.internPaidLeavesPerYear ?? config?.paidLeavesPerYear ?? 0,
    };
  }
  return {
    monthlyCap: config?.paidLeavesPerMonth ?? 0,
    yearlyCap: config?.paidLeavesPerYear ?? 0,
  };
}

export async function getLeaveBalance(
  employeeId: string,
  month: number,
  year: number,
  dateOfJoining?: Date,
  employmentType?: EmploymentType,
): Promise<LeaveBalance> {
  const { monthlyCap: rawMonth, yearlyCap: rawYear } = await getEffectivePaidLeaveCaps(
    employeeId,
    month,
    year,
    employmentType,
  );

  // Before the employee's joining month/year, they hadn't accrued anything.
  const beforeJoining =
    dateOfJoining &&
    (year < dateOfJoining.getUTCFullYear() ||
      (year === dateOfJoining.getUTCFullYear() && month < dateOfJoining.getUTCMonth() + 1));

  const allowanceMonth = beforeJoining ? 0 : rawMonth;
  const allowanceYear = dateOfJoining
    ? proratedAnnualAllowance(rawYear, dateOfJoining, year)
    : rawYear;

  const { start: monthStart, lastDay: monthEnd } = periodBounds(month, year);
  const { start: yearStart, lastDay: yearEnd } = yearBounds(year);

  const [usedMonth, usedYear, compensatedMonth, compensatedYear] = await Promise.all([
    getApprovedPaidLeaveDays(employeeId, month, year),
    getApprovedPaidLeaveDaysForYear(employeeId, year),
    getExpiredUnusedCreditCount(employeeId, monthStart, monthEnd),
    getExpiredUnusedCreditCount(employeeId, yearStart, yearEnd),
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
