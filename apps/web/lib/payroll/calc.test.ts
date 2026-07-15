import { describe, expect, test } from "bun:test";
import { computeNetPay, computeStandardDeductionTotal } from "./calc";

// PRD §5.2: net = base + incentive + bonus + other_addition
//               − (counts × flat rates) − other_deduction + reimbursements.

const RATES = {
  lateDeductionFlat: 500,
  halfDayDeductionFlat: 1000,
  unpaidLeaveDeductionFlat: 2000,
};

describe("computeStandardDeductionTotal", () => {
  test("multiplies each count by its flat rate", () => {
    expect(
      computeStandardDeductionTotal(
        { lateCount: 2, halfDayCount: 1, unpaidLeaveCount: 3 },
        RATES,
      ),
    ).toBe(2 * 500 + 1 * 1000 + 3 * 2000);
  });

  test("zero counts deduct nothing", () => {
    expect(
      computeStandardDeductionTotal(
        { lateCount: 0, halfDayCount: 0, unpaidLeaveCount: 0 },
        RATES,
      ),
    ).toBe(0);
  });
});

describe("computeNetPay", () => {
  const base = {
    baseSalary: 50000,
    incentiveAmount: 5000,
    bonusAmount: 2000,
    otherAdditionAmount: 0,
    otherDeductionAmount: 0,
    reimbursementTotal: 0,
  };

  test("adds additions and subtracts deductions per the PRD formula", () => {
    expect(
      computeNetPay(
        { ...base, otherAdditionAmount: 300, otherDeductionAmount: 700, reimbursementTotal: 1500 },
        2000,
      ),
    ).toBe(50000 + 5000 + 2000 + 300 - 2000 - 700 + 1500);
  });

  test("matches the Phase 5 live-verified example (net_pay 56300)", () => {
    // base 50000 + incentive 5000 + bonus 2000 − standard 2200 + reimb 1500
    expect(
      computeNetPay({ ...base, reimbursementTotal: 1500 }, 2200),
    ).toBe(56300);
  });

  test("deductions can push net pay below base salary", () => {
    expect(computeNetPay({ ...base, incentiveAmount: 0, bonusAmount: 0 }, 12000)).toBe(38000);
  });
});
