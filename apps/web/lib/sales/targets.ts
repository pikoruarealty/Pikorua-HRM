import { prisma } from "@/lib/db/prisma";

// Pillar 4/5 (2026-08-10) — resolving a rep's sales targets.
//
// Two layers, per the owner's decision: an org-wide default that an Admin edits
// in one place, and an optional per-employee override a Lead sets so a senior
// rep can carry 150 calls/day while a new joiner carries 60 — without moving
// everyone's number.
//
// SalesTargetConfig is versioned like PayrollConfig/LeaveConfig (a new row per
// edit, selected by effectiveFrom) so a past month's attainment reproduces the
// target that was actually in force then, not whatever it was later changed to.

export type SalesTargets = {
  dailyCallTarget: number;
  monthlySiteVisitTarget: number;
  monthlyBookingTarget: number;
};

/** Used when no SalesTargetConfig row exists yet — the same values as the
 *  column defaults, so behaviour is identical before and after an admin first
 *  saves the settings form. */
export const FALLBACK_TARGETS: SalesTargets = {
  dailyCallTarget: 100,
  monthlySiteVisitTarget: 20,
  monthlyBookingTarget: 2,
};

export type SalesTargetConfigResolved = SalesTargets & { autoAssignDailyCalls: boolean };

export async function getSalesTargetConfig(asOf: Date = new Date()): Promise<SalesTargetConfigResolved> {
  const row = await prisma.salesTargetConfig.findFirst({
    where: { effectiveFrom: { lte: asOf } },
    orderBy: { effectiveFrom: "desc" },
  });
  if (!row) return { ...FALLBACK_TARGETS, autoAssignDailyCalls: true };
  return {
    dailyCallTarget: row.dailyCallTarget,
    monthlySiteVisitTarget: row.monthlySiteVisitTarget,
    monthlyBookingTarget: row.monthlyBookingTarget,
    autoAssignDailyCalls: row.autoAssignDailyCalls,
  };
}

export type TargetOverrides = {
  dailyCallTarget: number | null;
  monthlySiteVisitTarget: number | null;
  monthlyBookingTarget: number | null;
};

/** Per-employee override wins where set; the org default fills every gap.
 *  Pure, so the precedence rule is unit-testable. */
export function resolveTargets(overrides: TargetOverrides, config: SalesTargets): SalesTargets {
  return {
    dailyCallTarget: overrides.dailyCallTarget ?? config.dailyCallTarget,
    monthlySiteVisitTarget: overrides.monthlySiteVisitTarget ?? config.monthlySiteVisitTarget,
    monthlyBookingTarget: overrides.monthlyBookingTarget ?? config.monthlyBookingTarget,
  };
}
