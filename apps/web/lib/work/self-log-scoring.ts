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
// The model estimates *hours of effort*, with the day's earlier entries in
// view (lib/ai/task-generation.ts). This module converts that estimate to
// points. Hours are a sizing guide, not a limit on how much can be logged.

/** [max hours, points] — the ladder hours map onto. Steps are fine enough that a
 *  4-hour job and an 8-hour one don't score alike. A single self-logged entry
 *  tops out at 8 points; large work can be split into distinct deliverables. */
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
