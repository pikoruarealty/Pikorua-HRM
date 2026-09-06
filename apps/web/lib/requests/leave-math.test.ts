import { describe, expect, test } from "bun:test";
import {
  allocateLeaveDaysAgainstCaps,
  countDaysClippedToPeriod,
  isPaidLeaveType,
  periodBounds,
  splitLeaveRangeByOverrides,
} from "./leave-math";

// Mirrors the live-verified 2.4b cases from progress.md: within-month (3d),
// a Jul 30 – Aug 2 span → July 2 / Aug 2, non-overlapping month → 0.
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("periodBounds", () => {
  test("first and last day of a 31-day month", () => {
    const { start, lastDay } = periodBounds(7, 2026);
    expect(start.toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(lastDay.toISOString().slice(0, 10)).toBe("2026-07-31");
  });

  test("handles February in a leap year", () => {
    const { lastDay } = periodBounds(2, 2028);
    expect(lastDay.toISOString().slice(0, 10)).toBe("2028-02-29");
  });

  test("December bounds don't spill into the next year", () => {
    const { lastDay } = periodBounds(12, 2026);
    expect(lastDay.toISOString().slice(0, 10)).toBe("2026-12-31");
  });
});

describe("countDaysClippedToPeriod", () => {
  test("range fully inside the period counts inclusively", () => {
    expect(countDaysClippedToPeriod(d("2026-07-10"), d("2026-07-12"), 7, 2026)).toBe(3);
  });

  test("single-day leave counts as 1", () => {
    expect(countDaysClippedToPeriod(d("2026-07-10"), d("2026-07-10"), 7, 2026)).toBe(1);
  });

  test("boundary-spanning range is clipped per month (Jul 30 – Aug 2)", () => {
    const from = d("2026-07-30");
    const to = d("2026-08-02");
    expect(countDaysClippedToPeriod(from, to, 7, 2026)).toBe(2); // Jul 30, 31
    expect(countDaysClippedToPeriod(from, to, 8, 2026)).toBe(2); // Aug 1, 2
    expect(countDaysClippedToPeriod(from, to, 6, 2026)).toBe(0); // June untouched
  });

  test("range covering the whole month counts every day", () => {
    expect(countDaysClippedToPeriod(d("2026-06-15"), d("2026-08-15"), 7, 2026)).toBe(31);
  });

  test("no overlap returns 0, never negative", () => {
    expect(countDaysClippedToPeriod(d("2026-01-01"), d("2026-01-05"), 7, 2026)).toBe(0);
  });
});

describe("splitLeaveRangeByOverrides", () => {
  test("no overrides: whole range stays a single segment of baseType", () => {
    const segs = splitLeaveRangeByOverrides(d("2026-07-10"), d("2026-07-14"), "leave_casual", new Map());
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe("leave_casual");
    expect(segs[0].dateFrom.toISOString().slice(0, 10)).toBe("2026-07-10");
    expect(segs[0].dateTo.toISOString().slice(0, 10)).toBe("2026-07-14");
  });

  test("middle days overridden unpaid splits into paid/unpaid/paid", () => {
    const overrides = new Map([
      ["2026-07-12", "leave_unpaid" as const],
      ["2026-07-13", "leave_unpaid" as const],
    ]);
    const segs = splitLeaveRangeByOverrides(d("2026-07-10"), d("2026-07-14"), "leave_casual", overrides);
    expect(segs.map((s) => [s.dateFrom.toISOString().slice(0, 10), s.dateTo.toISOString().slice(0, 10), s.type])).toEqual([
      ["2026-07-10", "2026-07-11", "leave_casual"],
      ["2026-07-12", "2026-07-13", "leave_unpaid"],
      ["2026-07-14", "2026-07-14", "leave_casual"],
    ]);
  });

  test("every day overridden to the same type as baseType collapses to one segment", () => {
    const overrides = new Map([
      ["2026-07-10", "leave_casual" as const],
      ["2026-07-11", "leave_casual" as const],
    ]);
    const segs = splitLeaveRangeByOverrides(d("2026-07-10"), d("2026-07-11"), "leave_casual", overrides);
    expect(segs).toHaveLength(1);
  });

  test("single-day range with an override produces one overridden segment", () => {
    const overrides = new Map([["2026-07-10", "leave_unpaid" as const]]);
    const segs = splitLeaveRangeByOverrides(d("2026-07-10"), d("2026-07-10"), "leave_casual", overrides);
    expect(segs).toEqual([{ dateFrom: d("2026-07-10"), dateTo: d("2026-07-10"), type: "leave_unpaid" }]);
  });

  test("sick leave base type overridden mid-range still splits correctly", () => {
    const overrides = new Map([["2026-07-11", "leave_unpaid" as const]]);
    const segs = splitLeaveRangeByOverrides(d("2026-07-10"), d("2026-07-12"), "leave_sick", overrides);
    expect(segs.map((s) => [s.dateFrom.toISOString().slice(0, 10), s.dateTo.toISOString().slice(0, 10), s.type])).toEqual([
      ["2026-07-10", "2026-07-10", "leave_sick"],
      ["2026-07-11", "2026-07-11", "leave_unpaid"],
      ["2026-07-12", "2026-07-12", "leave_sick"],
    ]);
  });
});

describe("isPaidLeaveType", () => {
  test("casual and sick are paid types", () => {
    expect(isPaidLeaveType("leave_casual")).toBe(true);
    expect(isPaidLeaveType("leave_sick")).toBe(true);
  });

  test("unpaid and unrelated types are not paid types", () => {
    expect(isPaidLeaveType("leave_unpaid")).toBe(false);
    expect(isPaidLeaveType("reimbursement")).toBe(false);
    expect(isPaidLeaveType("wfh")).toBe(false);
  });
});

describe("allocateLeaveDaysAgainstCaps", () => {
  test("stays paid throughout when well under both caps", () => {
    const overrides = allocateLeaveDaysAgainstCaps(d("2026-07-10"), d("2026-07-11"), new Map(), 0, 2, 12);
    expect(overrides.size).toBe(0);
  });

  test("overflow past the monthly cap converts only the excess days to unpaid", () => {
    // Monthly cap of 2, employee has already used 1 this month, requesting 3 more days:
    // the 1st fits under the cap (1 -> 2 used), the remaining 2 overflow it.
    const overrides = allocateLeaveDaysAgainstCaps(
      d("2026-07-10"),
      d("2026-07-12"),
      new Map([["2026-07", 1]]),
      1,
      2,
      12,
    );
    expect(Array.from(overrides.entries())).toEqual([
      ["2026-07-11", "leave_unpaid"],
      ["2026-07-12", "leave_unpaid"],
    ]);
  });

  test("a range spanning two months resets the monthly cap at the boundary", () => {
    // Cap of 2/month; 2026-07 already fully used, 2026-08 untouched.
    const overrides = allocateLeaveDaysAgainstCaps(
      d("2026-07-31"),
      d("2026-08-02"),
      new Map([["2026-07", 2]]),
      2,
      2,
      12,
    );
    expect(Array.from(overrides.entries())).toEqual([["2026-07-31", "leave_unpaid"]]);
  });

  test("hitting the annual cap converts remaining days to unpaid even under the monthly cap", () => {
    const overrides = allocateLeaveDaysAgainstCaps(d("2026-07-10"), d("2026-07-11"), new Map(), 11, 2, 12);
    expect(Array.from(overrides.entries())).toEqual([["2026-07-11", "leave_unpaid"]]);
  });
});
