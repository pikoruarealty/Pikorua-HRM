// Point crediting review gate (Pillar 2, 2026-08-08; tightened 2026-09-24).
//
// An admin-assigned atomic task never self-completes anymore: whatever the
// assignee does when they hit "Complete" always lands in `in_review` and
// waits for a Lead/Admin to accept or reject it — "mark complete" is the
// assignee's claim, not the verdict (2026-09-24, owner request: "make sure
// admin can approve/reject... just don't mark it as complete only"). A
// Lead/Admin can still complete an item directly via PATCH — that edit *is*
// the review, same as always.
//
// Self-logged work keeps its own, older rule: a catalog pick always needs a
// Lead's yes/no (nobody but the employee decided the task was real), while a
// free-text claim is priced by AI and only escalates once its estimate
// crosses the threshold — see requiresReviewForItem below for why those two
// don't collapse into "always review".
//
// The threshold is deliberately a single number in one place: tuning what
// counts as "big enough to escalate" for free-text self-logs is a one-value
// decision, not a config table.

const DEFAULT_REVIEW_THRESHOLD = 3;

/**
 * Points strictly above this value require Lead review. Override with
 * `WORK_ITEM_REVIEW_THRESHOLD`; a non-numeric or negative value falls back to
 * the default rather than silently disabling or universalising review.
 *
 * Set it to a very large number to effectively turn review off.
 */
export function reviewThreshold(): number {
  const raw = Number(process.env.WORK_ITEM_REVIEW_THRESHOLD);
  if (!Number.isFinite(raw) || raw < 0) return DEFAULT_REVIEW_THRESHOLD;
  return raw;
}

/**
 * Does an atomic task of this size need a Lead to sign it off before its points
 * are credited? `null`/`undefined` points (metric-mode items, which never pass
 * through review) are never gated.
 */
export function requiresReview(taskPoints: number | null | undefined): boolean {
  if (taskPoints == null) return false;
  return taskPoints > reviewThreshold();
}

/**
 * A reviewer may award more than a task's nominal size — exceptional work is
 * meant to be rewardable — but not without limit. Before 2026-08-10 both the
 * review route and the Lead's PATCH-complete path accepted any positive
 * integer, so a single entry of 99999 could dominate the Output component of
 * every composite score in a department and decide Employee of the Month.
 *
 * The ceiling is generous (double the nominal size) with an absolute floor, so
 * a 1-point chore can still be bumped to 10 for a genuinely outsized effort
 * while an 8-point task tops out at 16. Anything beyond that is a sign the task
 * was mis-sized, which is a conversation, not a review action.
 */
export const MAX_AWARD_MULTIPLIER = 2;
export const MIN_AWARD_CEILING = 10;

export function maxAwardablePoints(nominalPoints: number | null | undefined): number {
  const nominal = nominalPoints ?? 0;
  return Math.max(nominal * MAX_AWARD_MULTIPLIER, MIN_AWARD_CEILING);
}

/**
 * The same question for a whole WorkItem rather than a bare number.
 *
 * **Admin-assigned work** (not self-logged) always needs review now — someone
 * else decided the task and its size, so "did they actually finish it" is
 * always a second person's call, regardless of how many points it's worth.
 *
 * A **catalog** self-logged task (picked from the Admin-priced type list)
 * also always needs review, whatever it is worth: nobody but the employee
 * decided the task was real, so the Lead's yes/no is the only check there is
 * — skipping it for a 1-point item would leave a free points tap open.
 *
 * A **free-text** self-logged task (2026-08-14, owner request) is priced by
 * Groq the same way an AI-generated assigned task is, and is meant to behave
 * the same way at completion too — small estimates credit immediately, only
 * large ones go to a Lead. The trust moved from "a human picked the price" to
 * "the AI estimated it, conservatively, from what was written down", so it's
 * the one case that keeps the threshold instead of an unconditional gate.
 *
 * `taskPoints == null` (metric-mode items) is never gated — those complete by
 * hitting a target, not by an assignee's claim, and never reach this check.
 */
export function requiresReviewForItem(item: {
  taskPoints: number | null;
  selfLogged?: boolean | null;
  adhocTypeId?: string | null;
}): boolean {
  if (item.taskPoints == null) return false;
  if (!item.selfLogged) return true;
  if (item.adhocTypeId) return true;
  return requiresReview(item.taskPoints);
}
