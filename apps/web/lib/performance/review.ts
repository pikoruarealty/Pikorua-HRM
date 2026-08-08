// Monthly Lead quality review (Pillar 3, 2026-08-08) — pure period/rating
// helpers. Kept database-free so the rules that decide *which months can be
// reviewed* are unit-testable without a DB (same split as lib/work/review.ts
// vs. lib/work/notify.ts).

export const RATING_MIN = 1;
export const RATING_MAX = 5;

/** Short labels for the 1-5 scale. The wording is deliberately about the month,
 *  not the person — a Lead is rating a period of work, not assigning a grade. */
export const RATING_LABELS: Record<number, string> = {
  1: "Well below expectations",
  2: "Below expectations",
  3: "Met expectations",
  4: "Above expectations",
  5: "Outstanding",
};

export type Period = { periodYear: number; periodMonth: number };

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** The month `now` falls in. Reviews default to this period. */
export function currentPeriod(now: Date = new Date()): Period {
  return { periodYear: now.getUTCFullYear(), periodMonth: now.getUTCMonth() + 1 };
}

/** The month before `period` — the natural target when reviewing at month start. */
export function previousPeriod(period: Period): Period {
  if (period.periodMonth === 1) {
    return { periodYear: period.periodYear - 1, periodMonth: 12 };
  }
  return { periodYear: period.periodYear, periodMonth: period.periodMonth - 1 };
}

/** Sortable comparison key, so periods can be ordered/compared as numbers. */
export function periodOrdinal(period: Period): number {
  return period.periodYear * 12 + (period.periodMonth - 1);
}

/** "August 2026" */
export function periodLabel(period: Period): string {
  const name = MONTH_NAMES[period.periodMonth - 1] ?? String(period.periodMonth);
  return `${name} ${period.periodYear}`;
}

/**
 * A month that hasn't started yet can't be reviewed. The *current* month is
 * allowed on purpose: a Lead leaving on holiday should be able to record their
 * read of the month in progress rather than lose it.
 */
export function isFuturePeriod(period: Period, now: Date = new Date()): boolean {
  return periodOrdinal(period) > periodOrdinal(currentPeriod(now));
}

/** Guard against reviewing a month from before the employee existed, and
 *  against typo'd years landing decades out. */
export function isBeforeJoining(period: Period, dateOfJoining: Date): boolean {
  const joined: Period = {
    periodYear: dateOfJoining.getUTCFullYear(),
    periodMonth: dateOfJoining.getUTCMonth() + 1,
  };
  return periodOrdinal(period) < periodOrdinal(joined);
}

/**
 * Everything the period must satisfy, in one call — returns an error message
 * for the caller to hand to `failFor(VALIDATION, ...)`, or null when valid.
 */
export function validatePeriod(
  period: Period,
  dateOfJoining: Date,
  now: Date = new Date(),
): string | null {
  if (isFuturePeriod(period, now)) {
    return `${periodLabel(period)} hasn't started yet.`;
  }
  if (isBeforeJoining(period, dateOfJoining)) {
    return `${periodLabel(period)} is before this employee joined.`;
  }
  return null;
}

/** Average of a set of ratings, rounded to one decimal; null for an empty set. */
export function averageRating(ratings: number[]): number | null {
  if (ratings.length === 0) return null;
  const sum = ratings.reduce((a, b) => a + b, 0);
  return Math.round((sum / ratings.length) * 10) / 10;
}
