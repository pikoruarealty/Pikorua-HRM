// Track A. Pure payslip arithmetic, extracted from the generate route so the
// money math is unit-testable without a DB (production hardening, 2026-07-15).
// PRD §5.2: net = base + incentive + bonus + other_addition
//               − standard deductions (counts × flat rates) − other_deduction
//               + approved reimbursements.

export type DeductionRates = {
  lateDeductionFlat: number;
  halfDayDeductionFlat: number;
  unpaidLeaveDeductionFlat: number;
};

export type AttendanceCounts = {
  lateCount: number;
  halfDayCount: number;
  unpaidLeaveCount: number;
};

export type PayslipAmounts = {
  baseSalary: number;
  incentiveAmount: number;
  bonusAmount: number;
  otherAdditionAmount: number;
  otherDeductionAmount: number;
  reimbursementTotal: number;
};

export function computeStandardDeductionTotal(
  counts: AttendanceCounts,
  rates: DeductionRates,
): number {
  return (
    counts.lateCount * rates.lateDeductionFlat +
    counts.halfDayCount * rates.halfDayDeductionFlat +
    counts.unpaidLeaveCount * rates.unpaidLeaveDeductionFlat
  );
}

export function computeNetPay(
  amounts: PayslipAmounts,
  standardDeductionTotal: number,
): number {
  return (
    amounts.baseSalary +
    amounts.incentiveAmount +
    amounts.bonusAmount +
    amounts.otherAdditionAmount -
    standardDeductionTotal -
    amounts.otherDeductionAmount +
    amounts.reimbursementTotal
  );
}
