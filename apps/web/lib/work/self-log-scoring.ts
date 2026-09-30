// Deterministic half of self-logged task scoring (2026-09-30).
//
// Why this exists. Production showed one employee with 69 self-logged tasks and
// 409 points — 25 entries and 149 points on a single day — each one a single
// sentence listing the layers of one feature ("site-visit DTOs, controllers,
// services, routes and schema", then the migration as its own entry). The model
// sized every entry in isolation against a bare "1-13 story points, be
// skeptical" instruction, so dense technical wording read as big work and
// slicing one feature into pieces multiplied the score. (Re-running real
// production entries through the old prompt on the same model reproduced it:
// "I will redesign the whole UI today" scored 2, jargon-only typing tweaks 4-6.)
// The fix has two parts: the model now estimates *hours of effort* (a quantity
// it can judge without being swayed by vocabulary, with the day's earlier
// entries in view — lib/ai/task-generation.ts), and this module turns hours into
// points and enforces a per-day ceiling in code, where wording can't move it.

/** [max hours, points] — the ladder hours map onto. Steps are fine enough that a
 *  4-hour job and an 8-hour one don't score alike. A single self-logged entry
 *  tops out at one working day (8 points): a longer job is logged a day at a
 *  time. */
const LADDER: readonly (readonly [number, number])[] = [
  [0.5, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 5],
  [6, 6],
  [8, 8],
];

export function hoursToPoints(hours: number): number {
  if (!Number.isFinite(hours)) return 1;
  for (const [maxHours, points] of LADDER) if (hours <= maxHours) return points;
  return LADDER[LADDER.length - 1]![1];
}

/** The effort a point value stands for — the top of its band, so a day's
 *  entries are never under-counted against the ceiling. */
export function pointsToHours(points: number): number {
  for (const [maxHours, p] of LADDER) if (points <= p) return maxHours;
  return LADDER[LADDER.length - 1]![0];
}

/** The longest single entry, in hours. */
export const MAX_ENTRY_HOURS = 8;

/** How much effort one person can credibly claim to have put in on one day:
 *  their shift plus a quarter — generous, since estimates are fuzzy, but the
 *  difference between "a busy day" and 25 entries worth 100 hours. */
export function dailyCapHours(shiftHours: number): number {
  const shift = Number.isFinite(shiftHours) && shiftHours > 0 ? shiftHours : 8;
  return Math.round(shift * 1.25 * 10) / 10;
}

/** Effort already claimed today by the points logged so far. */
export function hoursClaimed(points: number[]): number {
  return points.reduce((sum, p) => sum + pointsToHours(p), 0);
}

export type CapDecision =
  | { allowed: false; remainingHours: number }
  | { allowed: true; hours: number; points: number; clamped: boolean };

/**
 * Fit an estimate into what is left of today's ceiling. Nothing left (less than
 * the smallest entry) -> refused; an estimate bigger than what's left is
 * clamped down to it rather than refused, so the last real piece of work in a
 * day still gets logged, just at what the day has room for.
 */
export function fitToDailyCap(estimatedHours: number, remainingHours: number): CapDecision {
  if (remainingHours < 0.5) return { allowed: false, remainingHours: Math.max(0, remainingHours) };
  const asked = Math.min(MAX_ENTRY_HOURS, Math.max(0.25, estimatedHours));
  // Clamp to a ladder step that fits, not to the raw remainder, so the points
  // charged never exceed the room left.
  let step = LADDER.findIndex(([maxHours]) => asked <= maxHours);
  if (step < 0) step = LADDER.length - 1;
  while (step > 0 && LADDER[step]![0] > remainingHours) step--;
  const [stepHours, points] = LADDER[step]!;
  const hours = Math.min(asked, stepHours);
  return { allowed: true, hours, points, clamped: hours < asked };
}
