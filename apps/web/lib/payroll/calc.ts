// Track A. Pure payslip arithmetic, extracted from the generate route so the
// money math is unit-testable without a DB (production hardening, 2026-07-15).
//
// Rewritten 2026-07-17 (twice, same day — confirmed with Umang both times):
// 1st pass made deductions proportional to salary instead of flat rupee
// amounts. 2nd pass (this one) fixed a deeper problem that surfaced from
// that: net pay was still "full base_salary minus deductions", so an
// employee with 0 present days still netted most of a month's pay. Net pay
// is now EARNINGS-based:
//   per_day_rate    = base_salary / 30 (fixed 30-day-month convention)
//   earned_base_pay = (present_days + half_days×0.5 + paid_leave_days
//                       + holiday_days + compensation_days) × per_day_rate
//   late_deduction  = late_count × (late_deduction_percent / 100) × per_day_rate
//   net_pay         = earned_base_pay + incentive + bonus + other_addition
//                      − late_deduction − other_deduction + reimbursements
// Absent and unpaid-leave days are simply EXCLUDED from earned_base_pay —
// not being paid for the day is the only consequence, no separate punitive
// deduction (confirmed: absent and unpaid-leave get identical treatment).
// Compensation days (a Sunday clocked in) are paid at the normal per-day
// rate, same weight as a present day — no overtime premium.

export type EarnedDayCounts = {
  presentDays: number;
  halfDays: number;
  paidLeaveDays: number;
  holidayDays: number;
  compensationDays: number;
};

export type PayslipAmounts = {
  earnedBasePay: number;
  incentiveAmount: number;
  bonusAmount: number;
  otherAdditionAmount: number;
  otherDeductionAmount: number;
  reimbursementTotal: number;
};

const HALF_DAY_FRACTION = 0.5;
const DAYS_PER_MONTH = 30;

/** base_salary / 30 — the fixed-30-day-month per-day pay rate. */
export function computePerDayRate(baseSalary: number): number {
  return baseSalary / DAYS_PER_MONTH;
}

/** Sum of every paid-day category, weighted, × the per-day rate. */
export function computeEarnedBasePay(days: EarnedDayCounts, perDayRate: number): number {
  const paidDays =
    days.presentDays +
    days.halfDays * HALF_DAY_FRACTION +
    days.paidLeaveDays +
    days.holidayDays +
    days.compensationDays;
  return paidDays * perDayRate;
}

/** Late-arrival penalty — a percentage of a day's pay per occurrence, on
 *  top of days actually worked (not a reduction of which days are paid). */
export function computeLateDeductionTotal(
  lateCount: number,
  perDayRate: number,
  lateDeductionPercent: number,
): number {
  return lateCount * (lateDeductionPercent / 100) * perDayRate;
}

export function computeNetPay(
  amounts: PayslipAmounts,
  lateDeductionTotal: number,
): number {
  return (
    amounts.earnedBasePay +
    amounts.incentiveAmount +
    amounts.bonusAmount +
    amounts.otherAdditionAmount -
    lateDeductionTotal -
    amounts.otherDeductionAmount +
    amounts.reimbursementTotal
  );
}
