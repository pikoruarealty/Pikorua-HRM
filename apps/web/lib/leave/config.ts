import { LeaveConfig } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

// Admin-configurable paid-leave allowance (2026-08-07, owner request).
// Versioned by effective_from like payroll_config (lib/payroll/config.ts) —
// never overwrite a historical row, so a balance computed for a past period
// reflects the allowance that was actually in force then.

/** The config row effective for a given month (1-12)/year — the most recent
 *  row whose effective_from is on/before the period start. */
export async function getEffectiveLeaveConfig(month: number, year: number): Promise<LeaveConfig | null> {
  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  return prisma.leaveConfig.findFirst({
    where: { effectiveFrom: { lte: periodStart } },
    // createdAt breaks ties between same-day edits — effectiveFrom alone is
    // not unique (the edit form defaults to today), so without it "most
    // recent" could resolve to whichever same-day row Postgres happened to
    // scan first (2026-08-16 bug, fixed across all versioned config tables).
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
  });
}

export async function getLatestLeaveConfig(): Promise<LeaveConfig | null> {
  return prisma.leaveConfig.findFirst({
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
  });
}
