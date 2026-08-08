import { describe, expect, test } from "bun:test";
import {
  RATING_LABELS,
  RATING_MAX,
  RATING_MIN,
  averageRating,
  currentPeriod,
  isBeforeJoining,
  isFuturePeriod,
  periodLabel,
  periodOrdinal,
  previousPeriod,
  validatePeriod,
} from "@/lib/performance/review";

const AUG_2026 = { periodYear: 2026, periodMonth: 8 };
const NOW = new Date("2026-08-08T10:00:00.000Z");

describe("period arithmetic", () => {
  test("currentPeriod reads the UTC month of the given instant", () => {
    expect(currentPeriod(NOW)).toEqual(AUG_2026);
  });

  test("previousPeriod steps back a month and wraps the year", () => {
    expect(previousPeriod(AUG_2026)).toEqual({ periodYear: 2026, periodMonth: 7 });
    expect(previousPeriod({ periodYear: 2026, periodMonth: 1 })).toEqual({
      periodYear: 2025,
      periodMonth: 12,
    });
  });

  test("periodOrdinal orders periods across year boundaries", () => {
    expect(periodOrdinal({ periodYear: 2026, periodMonth: 1 })).toBeGreaterThan(
      periodOrdinal({ periodYear: 2025, periodMonth: 12 }),
    );
    expect(periodOrdinal(AUG_2026)).toBe(periodOrdinal(AUG_2026));
  });

  test("periodLabel is human-readable", () => {
    expect(periodLabel(AUG_2026)).toBe("August 2026");
    expect(periodLabel({ periodYear: 2025, periodMonth: 12 })).toBe("December 2025");
  });
});

describe("isFuturePeriod", () => {
  test("the current month is reviewable, later months are not", () => {
    expect(isFuturePeriod(AUG_2026, NOW)).toBe(false);
    expect(isFuturePeriod({ periodYear: 2026, periodMonth: 9 }, NOW)).toBe(true);
    expect(isFuturePeriod({ periodYear: 2027, periodMonth: 1 }, NOW)).toBe(true);
  });

  test("past months are reviewable", () => {
    expect(isFuturePeriod({ periodYear: 2026, periodMonth: 7 }, NOW)).toBe(false);
    expect(isFuturePeriod({ periodYear: 2024, periodMonth: 12 }, NOW)).toBe(false);
  });
});

describe("isBeforeJoining", () => {
  const joined = new Date("2026-03-15T00:00:00.000Z");

  test("the joining month itself counts as reviewable", () => {
    expect(isBeforeJoining({ periodYear: 2026, periodMonth: 3 }, joined)).toBe(false);
  });

  test("months before joining are rejected", () => {
    expect(isBeforeJoining({ periodYear: 2026, periodMonth: 2 }, joined)).toBe(true);
    expect(isBeforeJoining({ periodYear: 2025, periodMonth: 12 }, joined)).toBe(true);
  });
});

describe("validatePeriod", () => {
  const joined = new Date("2026-03-15T00:00:00.000Z");

  test("accepts a valid period", () => {
    expect(validatePeriod(AUG_2026, joined, NOW)).toBeNull();
  });

  test("explains a future period", () => {
    expect(validatePeriod({ periodYear: 2026, periodMonth: 12 }, joined, NOW)).toBe(
      "December 2026 hasn't started yet.",
    );
  });

  test("explains a pre-joining period", () => {
    expect(validatePeriod({ periodYear: 2026, periodMonth: 1 }, joined, NOW)).toBe(
      "January 2026 is before this employee joined.",
    );
  });
});

describe("rating scale", () => {
  test("every point on the 1-5 scale has a label", () => {
    for (let r = RATING_MIN; r <= RATING_MAX; r++) {
      expect(RATING_LABELS[r]).toBeTruthy();
    }
    expect(Object.keys(RATING_LABELS)).toHaveLength(RATING_MAX - RATING_MIN + 1);
  });

  test("averageRating rounds to one decimal, null when empty", () => {
    expect(averageRating([])).toBeNull();
    expect(averageRating([4])).toBe(4);
    expect(averageRating([4, 5])).toBe(4.5);
    expect(averageRating([3, 4, 4])).toBe(3.7);
  });
});
