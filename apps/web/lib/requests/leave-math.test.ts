import { describe, expect, test } from "bun:test";
import { countDaysClippedToPeriod, periodBounds } from "./leave-math";

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
