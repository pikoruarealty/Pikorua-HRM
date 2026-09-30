import { attainmentPct, proRatedTarget, SALES_METRIC_WEIGHTS } from "@/lib/sales/pacing";
import type { SalesTargets } from "@/lib/sales/targets";

// 2026-09-30 — the WEEKLY recognition score for a sales/BD rep.
//
// Until now the weekly snapshot averaged the percentage of every metric WorkItem
// in the *month* — not the week — so after calls became one standing row reset
// every day it read "today's calls, plus whatever site visits/bookings the rep
// has booked this month, each as a % of a whole-month or whole-day target". That
// is not a measure of the week. This scores the week itself:
//
//  - calls: CRM + approved offline calls in the week against
//    dailyCallTarget × the days the rep was expected to be selling;
//  - site visits / bookings: the week's count against the monthly target
//    pro-rated to the week's share of the month's expected selling days.
//
// Each attainment is capped at 100 (overshooting calls must not buy back a
// missed booking), then blended with the owner's locked 10 / 17 / 23 weights,
// renormalised over whichever metrics actually have a target. The result is a
// 0-100 number, on the same scale as a monthly composite.

export type WeeklySalesInput = {
  calls: number;
  siteVisits: number;
  bookings: number;
  targets: SalesTargets;
  /** Days in the week the rep was expected to be selling (off days, holidays
   *  and approved leave already taken out). */
  expectedDaysInWeek: number;
  /** The month's full expected selling days — the denominator the monthly
   *  site-visit/booking targets are pro-rated against. */
  expectedDaysInMonth: number;
};

export type WeeklySalesResult = {
  /** 0-100, or null when nothing could be measured (no expected days / no targets). */
  score: number | null;
  callsPct: number | null;
  siteVisitsPct: number | null;
  bookingsPct: number | null;
};

const cap = (pct: number | null): number | null => (pct === null ? null : Math.min(100, Math.max(0, pct)));

export function weeklySalesScore(i: WeeklySalesInput): WeeklySalesResult {
  const callsTarget =
    i.targets.dailyCallTarget > 0 && i.expectedDaysInWeek > 0
      ? i.targets.dailyCallTarget * i.expectedDaysInWeek
      : null;
  const callsPct = cap(attainmentPct(i.calls, callsTarget));
  const siteVisitsPct = cap(
    attainmentPct(
      i.siteVisits,
      proRatedTarget(i.targets.monthlySiteVisitTarget, i.expectedDaysInWeek, i.expectedDaysInMonth),
    ),
  );
  const bookingsPct = cap(
    attainmentPct(
      i.bookings,
      proRatedTarget(i.targets.monthlyBookingTarget, i.expectedDaysInWeek, i.expectedDaysInMonth),
    ),
  );

  const parts: { value: number; weight: number }[] = [];
  if (callsPct !== null) parts.push({ value: callsPct, weight: SALES_METRIC_WEIGHTS.calls });
  if (siteVisitsPct !== null) parts.push({ value: siteVisitsPct, weight: SALES_METRIC_WEIGHTS.siteVisits });
  if (bookingsPct !== null) parts.push({ value: bookingsPct, weight: SALES_METRIC_WEIGHTS.bookings });

  if (parts.length === 0) return { score: null, callsPct, siteVisitsPct, bookingsPct };
  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  const blended = parts.reduce((s, p) => s + (p.value * p.weight) / totalWeight, 0);
  return { score: Math.round(blended * 10) / 10, callsPct, siteVisitsPct, bookingsPct };
}
