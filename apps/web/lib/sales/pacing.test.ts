import { describe, expect, test } from "bun:test";
import type { MonthlyBreakdown } from "@/lib/attendance/monthly-breakdown";
import {
  SALES_METRIC_WEIGHTS,
  attainmentPct,
  blendOutcome,
  expectedActivityDaysElapsed,
  proRatedTarget,
} from "./pacing";

function breakdown(over: Partial<MonthlyBreakdown> = {}): MonthlyBreakdown {
  return {
    presentDays: 0,
    halfDays: 0,
    holidayDays: 0,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    absentDays: 0,
    compensationDays: 0,
    workingDaysElapsed: 0,
    ...over,
  };
}

describe("expectedActivityDaysElapsed", () => {
  test("nets off holidays and both kinds of approved leave", () => {
    const b = breakdown({
      workingDaysElapsed: 20,
      holidayDays: 2,
      paidLeaveDays: 3,
      unpaidLeaveDays: 1,
    });
    expect(expectedActivityDaysElapsed(b)).toBe(14);
  });

  test("keeps absent days in — absence must not shrink the target", () => {
    const b = breakdown({ workingDaysElapsed: 10, absentDays: 4 });
    expect(expectedActivityDaysElapsed(b)).toBe(10);
  });

  test("never goes negative", () => {
    const b = breakdown({ workingDaysElapsed: 2, holidayDays: 5 });
    expect(expectedActivityDaysElapsed(b)).toBe(0);
  });
});

describe("proRatedTarget", () => {
  test("pro-rates a monthly target by expected working days", () => {
    // 20 bookings across 25 expected days, 10 elapsed -> 8.
    expect(proRatedTarget(20, 10, 25)).toBe(8);
  });

  test("is null on the first day of a month, not zero", () => {
    // Nothing has elapsed: unmeasurable, not "missed target".
    expect(proRatedTarget(20, 0, 25)).toBeNull();
  });

  test("is null when no target is set", () => {
    expect(proRatedTarget(0, 10, 25)).toBeNull();
  });

  test("caps elapsed at the month length so a full month is exactly the target", () => {
    expect(proRatedTarget(20, 30, 25)).toBe(20);
  });
});

describe("attainmentPct", () => {
  test("plain ratio as a percentage", () => {
    expect(attainmentPct(50, 100)).toBe(50);
  });

  test("null target is unmeasurable, not zero", () => {
    expect(attainmentPct(50, null)).toBeNull();
    expect(attainmentPct(50, 0)).toBeNull();
  });

  test("over-attainment is reported, not clipped", () => {
    // The composite clamps at its own boundary; this layer keeps the signal.
    expect(attainmentPct(150, 100)).toBe(150);
  });

  test("a measured zero is zero, not null", () => {
    expect(attainmentPct(0, 100)).toBe(0);
  });
});

describe("blendOutcome", () => {
  test("bookings outweigh site visits (the 17:23 split)", () => {
    expect(SALES_METRIC_WEIGHTS.bookings).toBeGreaterThan(SALES_METRIC_WEIGHTS.siteVisits);
    expect(SALES_METRIC_WEIGHTS.siteVisits).toBeGreaterThan(SALES_METRIC_WEIGHTS.calls);

    // 100% visits, 0% bookings must score below 50 — the whole point of the
    // owner's "many come for site visits, very few actually book" weighting.
    const visitsOnly = blendOutcome(100, 0);
    expect(visitsOnly).toBeCloseTo((100 * 17) / 40, 6);
    expect(visitsOnly!).toBeLessThan(50);
  });

  test("renormalises when only one outcome has a target", () => {
    expect(blendOutcome(80, null)).toBe(80);
    expect(blendOutcome(null, 60)).toBe(60);
  });

  test("null when neither outcome is measurable", () => {
    expect(blendOutcome(null, null)).toBeNull();
  });
});
