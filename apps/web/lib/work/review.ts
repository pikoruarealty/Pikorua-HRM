// Tiered point crediting (Pillar 2, 2026-08-08).
//
// Small atomic tasks keep the original behaviour: the assignee marks them done
// and the points land in `employee_point_ledger` in the same transaction.
// Anything worth *more* than the threshold is worth a second pair of eyes — it
// goes to `in_review` instead, and only a Lead accepting it credits points.
//
// The threshold is deliberately a single number in one place: the whole point
// of the tier is that most day-to-day tasks are unaffected, so tuning it is a
// one-value decision, not a config table.

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
