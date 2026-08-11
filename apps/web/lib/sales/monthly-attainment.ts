import { SalesMetric } from "@prisma/client";
import { attainmentPct, blendOutcome, proRatedTarget } from "@/lib/sales/pacing";

// Pillar 6 fix (2026-08-11) — turning a sales rep's metric WorkItems into the
// two score components the composite consumes.
//
// This exists because the previous reader averaged every metric WorkItem in the
// month into a single number. By mid-month a rep has ~20 daily `calls` rows and
// exactly one `site_visits` row and one `bookings` row, so a flat average was
// ~91% calls — the owner's locked 3:5:7 (calls : visits : bookings) weighting
// was nowhere in the score, and a rep could top the department on dialling
// alone while booking nothing. Metrics are therefore summed WITHIN their own
// kind first, and only then weighted.
//
// Two pacing rules, both of which exist to stop the score being a lie:
//
//  1. Calls are already paced by construction. One row is provisioned per day
//     the rep was expected to sell, so summing the rows' targets gives the
//     to-date target automatically — no day the rep hasn't reached yet, and no
//     weekly off, is in the denominator.
//
//  2. Site visits and bookings carry a WHOLE-MONTH target on a single row, so
//     they must be pro-rated (lib/sales/pacing.ts) against the days the rep was
//     actually expected to be selling. Without that, every rep in the org reads
//     as ~5% attainment on the 2nd of the month.
//
// Anything unmeasurable is null, never 0 — the same rule composite.ts relies on.
// A rep with no target set has not failed; we simply cannot say.

/** One metric's month-to-date position. */
export type MetricTotal = { current: number; target: number };

export type MetricTotals = {
  calls: MetricTotal;
  siteVisits: MetricTotal;
  bookings: MetricTotal;
};

export type SalesAttainment = {
  callsPct: number | null;
  siteVisitsPct: number | null;
  bookingsPct: number | null;
  /** Site visits and bookings blended 17:23 — the `salesOutcome` component. */
  outcomePct: number | null;
  callsDetail: string | null;
  outcomeDetail: string | null;
};

export type MetricItem = {
  assignedTo: string;
  salesMetric: SalesMetric | null;
  targetValue: unknown;
  currentValue: unknown;
};

function emptyTotals(): MetricTotals {
  return {
    calls: { current: 0, target: 0 },
    siteVisits: { current: 0, target: 0 },
    bookings: { current: 0, target: 0 },
  };
}

/** Prisma Decimal | number | null -> a finite number (0 when unusable). */
function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Sum a month's metric WorkItems per employee, per metric.
 *
 * Rows with no `salesMetric` are skipped: a metric-mode item that isn't one of
 * the three sales metrics is a hand-created target with no place in the locked
 * weighting, and folding it into one of the three buckets would silently
 * distort that bucket's attainment.
 */
export function summariseMetricItems(items: MetricItem[]): Map<string, MetricTotals> {
  const byEmployee = new Map<string, MetricTotals>();
  for (const item of items) {
    if (!item.salesMetric) continue;
    let totals = byEmployee.get(item.assignedTo);
    if (!totals) {
      totals = emptyTotals();
      byEmployee.set(item.assignedTo, totals);
    }
    const bucket =
      item.salesMetric === SalesMetric.calls
        ? totals.calls
        : item.salesMetric === SalesMetric.site_visits
          ? totals.siteVisits
          : totals.bookings;
    bucket.current += num(item.currentValue);
    bucket.target += num(item.targetValue);
  }
  return byEmployee;
}

/**
 * One rep's totals -> the component values the composite scores.
 *
 * `expectedDaysElapsed` / `expectedDaysInMonth` come from the attendance
 * breakdown and the month's off-day + holiday calendar; when either is
 * unusable the monthly outcomes are simply unmeasurable, which is a null, not
 * a zero.
 */
export function attainmentFor(
  totals: MetricTotals,
  expectedDaysElapsed: number,
  expectedDaysInMonth: number,
): SalesAttainment {
  // A target of 0 means "no target was set", not "target met" and not
  // "0% attained" — attainmentPct returns null for it, which drops the
  // component rather than scoring the rep on a target nobody gave them.
  const callsPct = attainmentPct(totals.calls.current, totals.calls.target || null);

  const visitPaced = proRatedTarget(
    totals.siteVisits.target,
    expectedDaysElapsed,
    expectedDaysInMonth,
  );
  const bookingPaced = proRatedTarget(
    totals.bookings.target,
    expectedDaysElapsed,
    expectedDaysInMonth,
  );
  const siteVisitsPct = attainmentPct(totals.siteVisits.current, visitPaced);
  const bookingsPct = attainmentPct(totals.bookings.current, bookingPaced);

  const outcomeParts: string[] = [];
  if (visitPaced !== null) {
    outcomeParts.push(`${totals.siteVisits.current} of ${Math.round(visitPaced)} visits`);
  }
  if (bookingPaced !== null) {
    outcomeParts.push(`${totals.bookings.current} of ${Math.round(bookingPaced)} bookings`);
  }

  return {
    callsPct,
    siteVisitsPct,
    bookingsPct,
    outcomePct: blendOutcome(siteVisitsPct, bookingsPct),
    callsDetail:
      totals.calls.target > 0
        ? `${totals.calls.current} of ${totals.calls.target} calls`
        : null,
    outcomeDetail: outcomeParts.length > 0 ? outcomeParts.join(", ") : null,
  };
}
