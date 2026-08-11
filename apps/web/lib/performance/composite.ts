// Pillar 6 (2026-08-08) — composite monthly performance score.
//
// Replaces the single-signal monthly recognition score (Tech = raw points,
// Sales/BD = average metric attainment) with a weighted blend of everything we
// can already measure honestly. Deliberately DB-free and pure so the weighting
// rules are unit-testable and so the API, the cron job and the UI all agree on
// what a score means.
//
// Two design rules worth knowing before changing anything here:
//
//  1. Every component is expressed on the SAME 0-100 scale before weighting.
//     Raw units (points, days, ratings) are converted by the small helpers at
//     the bottom of this file, never inline at the call site.
//
//  2. A component with no data is `null` (unavailable), NOT 0. Unavailable
//     components are dropped and the remaining weights are renormalised — see
//     computeComposite. This matters: an employee in their first month has no
//     performance review yet, and scoring that as 0/100 would punish them for
//     something they cannot control. Zero is reserved for "we measured, and the
//     answer was nothing".
//
// Weekly snapshots deliberately do NOT use this — quality reviews and monthly
// attendance are not meaningful over 7 days. Weekly keeps its raw scoring.

export type ComponentKey =
  | "output"
  | "quality"
  | "attendance"
  | "timeliness"
  | "adherence"
  | "salesOutcome";

export type WeightProfile = Record<ComponentKey, number>;

/**
 * Tech weights (locked by the owner, 2026-08-10). Relative, not absolute:
 * computeComposite renormalises over whichever components actually have data,
 * so they do not have to sum to 100 (they do, which keeps them readable as
 * percentages in the common case).
 *
 * Output carries half the score because shipping verified work is the job.
 * `salesOutcome` is inert here at weight 0 — a Tech department has no CRM
 * outcomes, and a 0-weight component can never affect a score.
 */
export const TECH_WEIGHTS: WeightProfile = {
  output: 50,
  quality: 17,
  attendance: 17,
  timeliness: 8,
  adherence: 8,
  salesOutcome: 0,
};

/**
 * Sales weights (locked by the owner, 2026-08-10). Output is still half the
 * score, but it is split across the three sales metrics in the ratio 3:5:7 —
 * calls 10, site visits 17, bookings 23 — because calls are a leading
 * indicator anyone can inflate while a booking is the outcome the business
 * actually needs.
 *
 * That split maps onto two component slots, not three: `output` carries the
 * calls attainment (10) and `salesOutcome` carries site visits + bookings
 * blended 17:23 (40 together) by `blendOutcome` in lib/sales/pacing.ts. The
 * ComponentKey set is deliberately unchanged — every downstream reader
 * (breakdown UI, stored snapshot JSON, recognition API) keys off it.
 *
 * `timeliness` is 0 for sales: due-dated tasks are a Tech concept, and the
 * sales equivalent — hitting a target inside the month — is already what the
 * paced attainment measures. Scoring it twice would double-count.
 */
export const SALES_WEIGHTS: WeightProfile = {
  output: 10,
  salesOutcome: 40,
  quality: 20,
  attendance: 20,
  timeliness: 0,
  adherence: 10,
};

/**
 * Back-compat alias for the default (Tech) table. Kept because the shape is
 * the contract for anything that introspects weights.
 */
export const COMPONENT_WEIGHTS: WeightProfile = TECH_WEIGHTS;

export const COMPONENT_LABELS: Record<ComponentKey, string> = {
  output: "Output",
  quality: "Quality",
  attendance: "Attendance",
  timeliness: "Timeliness",
  adherence: "Commitments kept",
  salesOutcome: "Sales outcomes",
};

/** Short human explanation of what each component measures — surfaced in the UI. */
export const COMPONENT_DESCRIPTIONS: Record<ComponentKey, string> = {
  output: "Verified task points earned this month, relative to the top scorer in the department.",
  quality: "Average of the Lead's monthly 1-5 quality ratings.",
  attendance: "Days present (half-days count half; holidays and approved paid leave don't count against you).",
  timeliness: "Share of tasks with a due date that were completed on or before it.",
  adherence: "Share of the tasks you committed to in Daily Planning that reached completed.",
  salesOutcome: "Closed-deal outcomes from the CRM.",
};

/**
 * Everything that differs between a Tech and a Sales score: the weights, and
 * the words. The same `output` slot means "task points vs the department's top
 * scorer" in Tech and "calls against your daily target" in Sales, so shipping
 * one wording for both would mislabel half the org's breakdown.
 */
export type ScoringProfile = {
  key: "tech" | "sales";
  weights: WeightProfile;
  labels: Record<ComponentKey, string>;
  descriptions: Record<ComponentKey, string>;
};

export const TECH_PROFILE: ScoringProfile = {
  key: "tech",
  weights: TECH_WEIGHTS,
  labels: COMPONENT_LABELS,
  descriptions: COMPONENT_DESCRIPTIONS,
};

export const SALES_PROFILE: ScoringProfile = {
  key: "sales",
  weights: SALES_WEIGHTS,
  labels: {
    ...COMPONENT_LABELS,
    output: "Calls",
    salesOutcome: "Site visits & bookings",
  },
  descriptions: {
    ...COMPONENT_DESCRIPTIONS,
    output: "Calls logged against your daily target, across the days you were expected to be selling.",
    salesOutcome:
      "Site visits and bookings against your monthly targets, pro-rated to the part of the month that has elapsed. Bookings count for more than visits.",
    timeliness: "Not scored for sales — hitting target inside the month is already measured above.",
  },
};

export function profileFor(isMetricDepartment: boolean): ScoringProfile {
  return isMetricDepartment ? SALES_PROFILE : TECH_PROFILE;
}

export type ComponentInput = {
  /** 0-100, or null when there is nothing to measure (component is dropped). */
  value: number | null;
  /** Human-readable evidence, e.g. "120 of 200 pts" — shown under the bar. */
  detail?: string;
};

export type CompositeComponent = {
  key: ComponentKey;
  label: string;
  /** Renormalised weight actually applied, as a percentage, 1dp. */
  weight: number;
  /** Nominal weight before renormalisation, for explaining the difference. */
  nominalWeight: number;
  value: number;
  detail: string | null;
  /**
   * What this component measured, in the wording of the scoring profile that
   * produced it. Optional because snapshots stored before 2026-08-11 have no
   * such field — readers fall back to COMPONENT_DESCRIPTIONS.
   */
  description?: string;
};

export type CompositeResult = {
  /** 0-100, 2dp. */
  score: number;
  components: CompositeComponent[];
  /** Components skipped because no data was available (or weight 0). */
  unavailable: ComponentKey[];
  /**
   * The subset of `unavailable` skipped purely because this profile gives them
   * weight 0 — they were never going to count and are not worth explaining as
   * "we couldn't measure it". Optional so snapshots stored before 2026-08-11
   * still parse; readers should fall back to treating `salesOutcome` as inert.
   */
  inert?: ComponentKey[];
};

const COMPONENT_ORDER: ComponentKey[] = [
  "output",
  "salesOutcome",
  "quality",
  "attendance",
  "timeliness",
  "adherence",
];

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

/**
 * Weighted blend of the supplied components, renormalised over the ones that
 * have data. Returns 0 with an empty component list when nothing is measurable
 * — a brand-new employee with no activity at all scores 0, which is correct.
 *
 * `profile` selects the weight table and the wording (2026-08-11). It defaults
 * to Tech so every pre-existing caller keeps its behaviour; the renormalisation
 * rule is identical for both profiles — a component with weight 0, or with no
 * data, is dropped and the rest scale up to cover it.
 */
export function computeComposite(
  inputs: Partial<Record<ComponentKey, ComponentInput>>,
  profile: ScoringProfile = TECH_PROFILE,
): CompositeResult {
  const weights = profile.weights;
  const available: { key: ComponentKey; value: number; detail: string | null }[] = [];
  const unavailable: ComponentKey[] = [];
  const inert: ComponentKey[] = [];

  for (const key of COMPONENT_ORDER) {
    const nominal = weights[key];
    const input = inputs[key];
    if (nominal <= 0) {
      unavailable.push(key);
      inert.push(key);
      continue;
    }
    if (!input || input.value === null || !Number.isFinite(input.value)) {
      unavailable.push(key);
      continue;
    }
    available.push({ key, value: clampScore(input.value), detail: input.detail ?? null });
  }

  const totalWeight = available.reduce((sum, c) => sum + weights[c.key], 0);
  if (totalWeight <= 0) {
    return { score: 0, components: [], unavailable, inert };
  }

  let score = 0;
  const components: CompositeComponent[] = available.map((c) => {
    const weight = (weights[c.key] / totalWeight) * 100;
    score += (c.value * weights[c.key]) / totalWeight;
    return {
      key: c.key,
      label: profile.labels[c.key],
      weight: round(weight, 1),
      nominalWeight: weights[c.key],
      value: round(c.value, 1),
      detail: c.detail,
      description: profile.descriptions[c.key],
    };
  });

  return { score: round(clampScore(score), 2), components, unavailable, inert };
}

// ---------------------------------------------------------------------------
// Raw-unit -> 0-100 converters. Each returns null when the input is not
// measurable, which is what makes the renormalisation above kick in.
// ---------------------------------------------------------------------------

/**
 * Output relative to the best performer in the same department that period.
 * Comparing points across departments would be meaningless (a Tech point and a
 * Sales point are not the same thing), so the top scorer defines 100 and
 * everyone else is measured against them.
 *
 * Returns null when nobody scored anything — with no top scorer there is no
 * scale, and marking the whole department 0 on their biggest component would
 * be noise, not signal.
 */
export function relativeToBest(value: number, best: number): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(best) || best <= 0) return null;
  return clampScore((value / best) * 100);
}

/** A 1-5 review rating onto 0-100 (1 -> 0, 3 -> 50, 5 -> 100). */
export function ratingToScore(rating: number | null): number | null {
  if (rating === null || !Number.isFinite(rating)) return null;
  return clampScore(((rating - 1) / 4) * 100);
}

/** numerator/denominator as a percentage; null when there was nothing to divide. */
export function ratioToScore(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return clampScore((numerator / denominator) * 100);
}

export type AttendanceInput = {
  presentDays: number;
  halfDays: number;
  holidayDays: number;
  paidLeaveDays: number;
  workingDaysElapsed: number;
};

/**
 * Attendance as "share of elapsed working days credited". Half-days count
 * half. Holidays and approved paid leave count as full credit — they are
 * entitlements, and docking someone for taking approved leave would turn the
 * score into a reason not to take it. Absence and approved *unpaid* leave are
 * what actually pull this down.
 */
export function attendanceToScore(b: AttendanceInput): number | null {
  if (b.workingDaysElapsed <= 0) return null;
  const credited = b.presentDays + b.halfDays * 0.5 + b.holidayDays + b.paidLeaveDays;
  return ratioToScore(credited, b.workingDaysElapsed);
}
