import { describe, expect, test } from "bun:test";
import {
  computeEarnedBasePay,
  computeLateDeductionTotal,
  computeNetPay,
  computePerDayRate,
} from "./calc";

// Earned-pay formula (2026-07-17, follow-up): net pay is earnings-based, not
// base-salary-minus-deductions. per_day_rate = base_salary / 30. Present/
// half-day(50%)/paid-leave/holiday/compensation days are paid; absent and
// unpaid-leave days are simply excluded (no separate deduction). Late is a
// percentage penalty on top of days actually worked.

describe("computePerDayRate", () => {
  test("divides base salary by a fixed 30-day month", () => {
    expect(computePerDayRate(30000)).toBe(1000);
    expect(computePerDayRate(50000)).toBeCloseTo(1666.6667, 3);
  });
});

describe("computeEarnedBasePay", () => {
  const perDayRate = 1000; // salary 30000

  test("present days are paid in full", () => {
    expect(
      computeEarnedBasePay(
        { presentDays: 10, halfDays: 0, paidLeaveDays: 0, holidayDays: 0, compensationDays: 0 },
        perDayRate,
      ),
    ).toBe(10000);
  });

  test("half-days are paid at half rate", () => {
    expect(
      computeEarnedBasePay(
        { presentDays: 0, halfDays: 2, paidLeaveDays: 0, holidayDays: 0, compensationDays: 0 },
        perDayRate,
      ),
    ).toBe(1000);
  });

  test("paid leave, holidays, and compensation days are paid in full and combine additively", () => {
    // 10 present + 2 half-day (=1) + 1 holiday + 1 paid leave + 1 compensation = 14 paid-day-equivalents
    expect(
      computeEarnedBasePay(
        { presentDays: 10, halfDays: 2, paidLeaveDays: 1, holidayDays: 1, compensationDays: 1 },
        perDayRate,
      ),
    ).toBe(14000);
  });

  test("zero paid days earns nothing (the bug this fixes: 0 present days must not still pay most of a month)", () => {
    expect(
      computeEarnedBasePay(
        { presentDays: 0, halfDays: 0, paidLeaveDays: 0, holidayDays: 0, compensationDays: 0 },
        perDayRate,
      ),
    ).toBe(0);
  });
});

describe("computeLateDeductionTotal", () => {
  test("is a percentage of a day's pay per late occurrence", () => {
    expect(computeLateDeductionTotal(2, 1000, 20)).toBe(400); // 2 * 0.2 * 1000
  });

  test("zero late occurrences deduct nothing", () => {
    expect(computeLateDeductionTotal(0, 1000, 20)).toBe(0);
  });
});

describe("computeNetPay", () => {
  const base = {
    earnedBasePay: 45000,
    incentiveAmount: 5000,
    bonusAmount: 2000,
    otherAdditionAmount: 0,
    otherDeductionAmount: 0,
    reimbursementTotal: 0,
  };

  test("adds additions and subtracts the late deduction per the formula", () => {
    expect(
      computeNetPay(
        { ...base, otherAdditionAmount: 300, otherDeductionAmount: 700, reimbursementTotal: 1500 },
        400,
      ),
    ).toBe(45000 + 5000 + 2000 + 300 - 400 - 700 + 1500);
  });

  test("worked example: 0 present days out of a full month nets to (near) zero", () => {
    // salary 50000, per-day 1666.67, 0 paid days -> earned_base_pay 0, no
    // late/incentive/bonus/reimbursement -> net pay 0.
    expect(computeNetPay({ ...base, earnedBasePay: 0, incentiveAmount: 0, bonusAmount: 0 }, 0)).toBe(0);
  });
});
