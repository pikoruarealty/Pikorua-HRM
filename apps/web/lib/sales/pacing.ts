import type { MonthlyBreakdown } from "@/lib/attendance/monthly-breakdown";

// Pillar 5 (2026-08-10) — pro-rating sales targets against the days a rep was
// actually expected to work.
//
// The whole reason this file exists: a flat "month's target ÷ calendar days
// elapsed" makes every rep look like they are missing target on their weekly
// off and on approved leave. Targets must be paced against expected WORKING
// days, honouring weekly-offs (including WeeklyOffMove), holidays and approved
// leave — all of which lib/attendance/monthly-breakdown.ts already computes.
// This module deliberately consumes that output rather than recomputing it.

/**
 * Days in the elapsed part of the month on which the rep was actually expected
 * to be selling.
 *
 * `workingDaysElapsed` from the attendance breakdown counts every expected
 * working day INCLUDING ones spent on holiday or approved leave (correct for
 * payroll — those are paid). For activity targets they must come out: nobody
 * is expected to dial on a public holiday or while on approved leave.
 *
 * Absent days deliberately stay IN. An unexplained absence is a day the rep was
 * expected to work and did not — removing it would quietly reward absence by
 * shrinking the target.
 */
export function expectedActivityDaysElapsed(b: MonthlyBreakdown): number {
  const days = b.workingDaysElapsed - b.holidayDays - b.paidLeaveDays - b.unpaidLeaveDays;
  return days > 0 ? days : 0;
}

/**
 * A monthly target pro-rated to the elapsed portion of the month.
 *
 * Returns null when there is nothing to pace against (no expected days yet, or
 * no known month length) — null means "unmeasurable", which callers must render
 * as "—" rather than as 0% attainment. Scoring someone 0% on the 1st of the
 * month because no days have elapsed would be nonsense.
 */
export function proRatedTarget(
  monthlyTarget: number,
  expectedDaysElapsed: number,
  expectedDaysInMonth: number,
): number | null {
  if (!Number.isFinite(monthlyTarget) || monthlyTarget <= 0) return null;
  if (expectedDaysInMonth <= 0 || expectedDaysElapsed <= 0) return null;
  const capped = Math.min(expectedDaysElapsed, expectedDaysInMonth);
  return (monthlyTarget * capped) / expectedDaysInMonth;
}

/**
 * Attainment as a percentage of target. Null when there is no target to measure
 * against — NOT 0. This is the same "unavailable vs. measured zero" distinction
 * the composite score relies on (lib/performance/composite.ts): a rep with no
 * target set has not failed, we simply cannot say.
 *
 * Uncapped on the upside: exceeding target is real information, and the
 * composite clamps to 100 at its own boundary.
 */
export function attainmentPct(current: number, target: number | null): number | null {
  if (target === null || !Number.isFinite(target) || target <= 0) return null;
  if (!Number.isFinite(current)) return null;
  return (current / target) * 100;
}

/**
 * Blend the three sales attainments into the two score components the composite
 * consumes, using the owner's locked 10 / 17 / 23 weighting (2026-08-10).
 *
 * Calls are a leading indicator and stay deliberately cheap; site visits and
 * bookings are the outcomes the business actually needs, with bookings weighted
 * highest because many prospects take a site visit and very few go on to book.
 *
 * Components with no target are dropped and the remaining weights renormalised
 * within their own group — the same rule computeComposite applies one level up.
 */
export const SALES_METRIC_WEIGHTS = {
  calls: 10,
  siteVisits: 17,
  bookings: 23,
} as const;

export function blendOutcome(
  siteVisitsPct: number | null,
  bookingsPct: number | null,
): number | null {
  const parts: { value: number; weight: number }[] = [];
  if (siteVisitsPct !== null) parts.push({ value: siteVisitsPct, weight: SALES_METRIC_WEIGHTS.siteVisits });
  if (bookingsPct !== null) parts.push({ value: bookingsPct, weight: SALES_METRIC_WEIGHTS.bookings });
  if (parts.length === 0) return null;

  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  return parts.reduce((s, p) => s + (p.value * p.weight) / totalWeight, 0);
}
