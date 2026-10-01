import { describe, expect, test } from "bun:test";
import {
  addLeaveToDay,
  countDaysClippedToPeriod,
  countDaysClippedToYear,
  isPaidLeaveType,
  partsToSegments,
  periodBounds,
  planLeaveParts,
  splitLeaveRangeByOverrides,
  type LeaveCaps,
  type LeaveDayEntry,
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

// The paid-leave allowance now flows through planLeaveParts (it also handles
// half-days). These are the original cap-overflow cases, expressed against it: a
// day that doesn't fit becomes unpaid, the rest stay paid.
const caps = (over: Partial<LeaveCaps> = {}): LeaveCaps => ({
  approvedPaidByMonthKey: new Map(),
  approvedPaidThisYear: 0,
  monthlyCap: 2,
  yearlyCap: 12,
  ...over,
});
const unpaidDates = (from: string, to: string, c: LeaveCaps) =>
  planLeaveParts({ dateFrom: d(from), dateTo: d(to), baseType: "leave_casual", caps: c })
    .filter((p) => p.type === "leave_unpaid")
    .map((p) => p.date);

describe("planLeaveParts — paid-leave caps (whole days)", () => {
  test("stays paid throughout when well under both caps", () => {
    expect(unpaidDates("2026-07-10", "2026-07-11", caps())).toEqual([]);
  });

  test("overflow past the monthly cap converts only the excess days to unpaid", () => {
    // Monthly cap of 2, employee has already used 1 this month, requesting 3 more days:
    // the 1st fits under the cap (1 -> 2 used), the remaining 2 overflow it.
    expect(
      unpaidDates(
        "2026-07-10",
        "2026-07-12",
        caps({ approvedPaidByMonthKey: new Map([["2026-07", 1]]), approvedPaidThisYear: 1 }),
      ),
    ).toEqual(["2026-07-11", "2026-07-12"]);
  });

  test("a range spanning two months resets the monthly cap at the boundary", () => {
    // Cap of 2/month; 2026-07 already fully used, 2026-08 untouched.
    expect(
      unpaidDates(
        "2026-07-31",
        "2026-08-02",
        caps({ approvedPaidByMonthKey: new Map([["2026-07", 2]]), approvedPaidThisYear: 2 }),
      ),
    ).toEqual(["2026-07-31"]);
  });

  test("hitting the annual cap converts remaining days to unpaid even under the monthly cap", () => {
    expect(unpaidDates("2026-07-10", "2026-07-11", caps({ approvedPaidThisYear: 11 }))).toEqual(["2026-07-11"]);
  });

  test("without caps nothing is converted", () => {
    const parts = planLeaveParts({ dateFrom: d("2026-07-10"), dateTo: d("2026-07-14"), baseType: "leave_sick" });
    expect(parts.every((p) => p.type === "leave_sick" && !p.half)).toBe(true);
  });

  test("unpaid leave is never capped", () => {
    const parts = planLeaveParts({
      dateFrom: d("2026-07-10"),
      dateTo: d("2026-07-12"),
      baseType: "leave_unpaid",
      caps: caps({ monthlyCap: 0, yearlyCap: 0 }),
    });
    expect(parts.map((p) => p.type)).toEqual(["leave_unpaid", "leave_unpaid", "leave_unpaid"]);
  });
});

describe("half-day leave (2026-10-01)", () => {
  const iso = (x: Date) => x.toISOString().slice(0, 10);

  test("a half-day row counts 0.5 of a day in a month and in a year", () => {
    expect(countDaysClippedToPeriod(d("2026-07-10"), d("2026-07-10"), 7, 2026, true)).toBe(0.5);
    expect(countDaysClippedToPeriod(d("2026-07-10"), d("2026-07-10"), 7, 2026, false)).toBe(1);
    expect(countDaysClippedToYear(d("2026-07-10"), d("2026-07-10"), 2026, true)).toBe(0.5);
    // Outside the period it is still nothing.
    expect(countDaysClippedToPeriod(d("2026-07-10"), d("2026-07-10"), 8, 2026, true)).toBe(0);
  });

  test("a half-day request stays a single half-day row", () => {
    const segs = partsToSegments(
      planLeaveParts({ dateFrom: d("2026-07-10"), dateTo: d("2026-07-10"), baseType: "leave_casual", baseHalf: true }),
    );
    expect(segs).toEqual([{ dateFrom: d("2026-07-10"), dateTo: d("2026-07-10"), type: "leave_casual", halfDay: true }]);
  });

  test("approving one day of a 3-day request as a half day splits it into whole / half / whole", () => {
    const segs = partsToSegments(
      planLeaveParts({
        dateFrom: d("2026-07-10"),
        dateTo: d("2026-07-12"),
        baseType: "leave_casual",
        halfDates: new Set(["2026-07-11"]),
      }),
    );
    expect(segs.map((s) => [iso(s.dateFrom), iso(s.dateTo), s.halfDay ?? false])).toEqual([
      ["2026-07-10", "2026-07-10", false],
      ["2026-07-11", "2026-07-11", true],
      ["2026-07-12", "2026-07-12", false],
    ]);
  });

  test("a half day uses only half a day of the monthly allowance", () => {
    // 1.5 of 2 used. A half day fits (room 0.5); a whole day would not.
    const used = caps({ approvedPaidByMonthKey: new Map([["2026-07", 1.5]]), approvedPaidThisYear: 1.5 });
    const half = planLeaveParts({
      dateFrom: d("2026-07-10"),
      dateTo: d("2026-07-10"),
      baseType: "leave_casual",
      baseHalf: true,
      caps: used,
    });
    expect(half).toEqual([{ date: "2026-07-10", type: "leave_casual", half: true }]);
  });

  test("a whole day with only half an allowance left splits into a paid half and an unpaid half", () => {
    const used = caps({ approvedPaidByMonthKey: new Map([["2026-07", 1.5]]), approvedPaidThisYear: 1.5 });
    const whole = planLeaveParts({
      dateFrom: d("2026-07-10"),
      dateTo: d("2026-07-10"),
      baseType: "leave_casual",
      caps: used,
    });
    expect(whole).toEqual([
      { date: "2026-07-10", type: "leave_casual", half: true },
      { date: "2026-07-10", type: "leave_unpaid", half: true },
    ]);
    // Never more than the allowance: 1.5 + 0.5 = 2.
    const segs = partsToSegments(whole);
    expect(segs).toHaveLength(2);
    expect(segs.every((s) => s.halfDay === true)).toBe(true);
  });

  test("a half day beyond the allowance becomes an unpaid half day", () => {
    const full = caps({ approvedPaidByMonthKey: new Map([["2026-07", 2]]), approvedPaidThisYear: 2 });
    const half = planLeaveParts({
      dateFrom: d("2026-07-10"),
      dateTo: d("2026-07-10"),
      baseType: "leave_sick",
      baseHalf: true,
      caps: full,
    });
    expect(half).toEqual([{ date: "2026-07-10", type: "leave_unpaid", half: true }]);
  });

  test("allowance is spent in order across days, halves included", () => {
    // 1 of 2 used; day 1 whole (fits, 2/2), day 2 half (no room -> unpaid half).
    const c = caps({ approvedPaidByMonthKey: new Map([["2026-07", 1]]), approvedPaidThisYear: 1 });
    const parts = planLeaveParts({
      dateFrom: d("2026-07-10"),
      dateTo: d("2026-07-11"),
      baseType: "leave_casual",
      halfDates: new Set(["2026-07-11"]),
      caps: c,
    });
    expect(parts).toEqual([
      { date: "2026-07-10", type: "leave_casual", half: false },
      { date: "2026-07-11", type: "leave_unpaid", half: true },
    ]);
  });

  test("a manual type override still wins and composes with a half day", () => {
    const parts = planLeaveParts({
      dateFrom: d("2026-07-10"),
      dateTo: d("2026-07-11"),
      baseType: "leave_casual",
      halfDates: new Set(["2026-07-10"]),
      typeOverrides: new Map([["2026-07-10", "leave_unpaid" as const]]),
    });
    expect(parts[0]).toEqual({ date: "2026-07-10", type: "leave_unpaid", half: true });
    expect(parts[1]).toEqual({ date: "2026-07-11", type: "leave_casual", half: false });
  });

  test("contiguous half days of the same type coalesce; whole and half never merge", () => {
    const segs = partsToSegments([
      { date: "2026-07-10", type: "leave_casual", half: true },
      { date: "2026-07-11", type: "leave_casual", half: true },
      { date: "2026-07-12", type: "leave_casual", half: false },
    ]);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ halfDay: true });
    expect(segs[0]!.dateTo).toEqual(d("2026-07-11"));
    expect(segs[1]!.halfDay).toBeUndefined();
  });
});

describe("addLeaveToDay — one day can never be more than one day of leave", () => {
  const entry = (rows: [string, boolean][]) => {
    const m = new Map<string, LeaveDayEntry>();
    for (const [type, half] of rows) addLeaveToDay(m, "2026-07-10", type, half);
    return m.get("2026-07-10");
  };

  test("a whole paid day and a half day on the same date are capped at one", () => {
    expect(entry([["leave_casual", false], ["leave_sick", true]])).toEqual({ paid: 1, unpaid: 0 });
  });

  test("a paid half and an unpaid half make exactly one day", () => {
    expect(entry([["leave_casual", true], ["leave_unpaid", true]])).toEqual({ paid: 0.5, unpaid: 0.5 });
  });

  test("two half days of the same kind make a whole day, not two", () => {
    expect(entry([["leave_unpaid", true], ["leave_unpaid", true]])).toEqual({ paid: 0, unpaid: 1 });
    expect(entry([["leave_unpaid", true], ["leave_unpaid", true], ["leave_unpaid", true]])).toEqual({ paid: 0, unpaid: 1 });
  });

  test("overlapping paid and unpaid whole days resolve to paid, whichever came first", () => {
    expect(entry([["leave_unpaid", false], ["leave_casual", false]])).toEqual({ paid: 1, unpaid: 0 });
    expect(entry([["leave_casual", false], ["leave_unpaid", false]])).toEqual({ paid: 1, unpaid: 0 });
  });
});
