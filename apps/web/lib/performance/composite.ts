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

/**
 * Nominal weights. These are *relative*: computeComposite renormalises over
 * whichever components actually have data, so they do not have to sum to 100
 * (they do, which keeps them readable as percentages in the common case).
 *
 * `salesOutcome` is a deliberate placeholder at weight 0 — the slot for real
 * closed-deal outcomes from the CRM (Pillars 4/5), which is still being built.
 * At weight 0 it can never affect a score, so the slot is inert until the CRM
 * lands and the weight is raised. Do not remove it; the shape is the contract.
 */
export const COMPONENT_WEIGHTS: Record<ComponentKey, number> = {
  output: 40,
  quality: 20,
  attendance: 20,
  timeliness: 10,
  adherence: 10,
  salesOutcome: 0,
};

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
};

export type CompositeResult = {
  /** 0-100, 2dp. */
  score: number;
  components: CompositeComponent[];
  /** Components skipped because no data was available (or weight 0). */
  unavailable: ComponentKey[];
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
 */
export function computeComposite(
  inputs: Partial<Record<ComponentKey, ComponentInput>>,
): CompositeResult {
  const available: { key: ComponentKey; value: number; detail: string | null }[] = [];
  const unavailable: ComponentKey[] = [];

  for (const key of COMPONENT_ORDER) {
    const nominal = COMPONENT_WEIGHTS[key];
    const input = inputs[key];
    if (nominal <= 0 || !input || input.value === null || !Number.isFinite(input.value)) {
      unavailable.push(key);
      continue;
    }
    available.push({ key, value: clampScore(input.value), detail: input.detail ?? null });
  }

  const totalWeight = available.reduce((sum, c) => sum + COMPONENT_WEIGHTS[c.key], 0);
  if (totalWeight <= 0) {
    return { score: 0, components: [], unavailable };
  }

  let score = 0;
  const components: CompositeComponent[] = available.map((c) => {
    const weight = (COMPONENT_WEIGHTS[c.key] / totalWeight) * 100;
    score += (c.value * COMPONENT_WEIGHTS[c.key]) / totalWeight;
    return {
      key: c.key,
      label: COMPONENT_LABELS[c.key],
      weight: round(weight, 1),
      nominalWeight: COMPONENT_WEIGHTS[c.key],
      value: round(c.value, 1),
      detail: c.detail,
    };
  });

  return { score: round(clampScore(score), 2), components, unavailable };
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
