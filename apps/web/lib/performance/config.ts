import { prisma } from "@/lib/db/prisma";

// Pillar 6 (2026-08-11) — resolving the composite-score knobs.
//
// Versioned exactly like SalesTargetConfig / PayrollConfig / LeaveConfig: each
// admin edit inserts a new row and the row in force for a given date is the
// latest one whose `effectiveFrom` is on or before it. That matters here in a
// way it doesn't for a plain settings blob — turning scoring on in September
// must not retroactively publish scores for August, and raising the
// self-logged cap must not silently rewrite last month's ranks.

export type PerformanceConfigResolved = {
  scoringEnabled: boolean;
  selfLoggedCapPercent: number;
};

/**
 * Defaults used when no PerformanceConfig row exists yet — identical to the
 * column defaults, so behaviour is the same before and after an Admin first
 * saves the settings form. Scoring starts OFF: the grace period is the safe
 * state, and publishing ranks built on knowingly incomplete first-weeks data
 * would be worse than publishing nothing.
 */
export const FALLBACK_PERFORMANCE_CONFIG: PerformanceConfigResolved = {
  scoringEnabled: false,
  selfLoggedCapPercent: 30,
};

export async function getPerformanceConfig(
  asOf: Date = new Date(),
): Promise<PerformanceConfigResolved> {
  const row = await prisma.performanceConfig.findFirst({
    where: { effectiveFrom: { lte: asOf } },
    orderBy: { effectiveFrom: "desc" },
  });
  if (!row) return { ...FALLBACK_PERFORMANCE_CONFIG };
  return {
    scoringEnabled: row.scoringEnabled,
    selfLoggedCapPercent: row.selfLoggedCapPercent,
  };
}
