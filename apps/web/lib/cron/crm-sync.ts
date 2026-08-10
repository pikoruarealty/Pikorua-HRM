import { Role, SalesMatchMethod } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { createLogger } from "@/lib/log";
import { CrmSyncError, crmConfigured, fetchActivity } from "@/lib/sales/crm-client";
import { buildMatchIndex, matchRow } from "@/lib/sales/matching";
import { provisionSalesTargets, SALES_ROLES } from "@/lib/sales/provisioning";
import { syncEmployeeMetrics } from "@/lib/sales/write-through";

// Pillar 4 (2026-08-10) — hourly pull of per-rep sales activity from the
// in-house CRM, in the same shape as the other lib/cron/* jobs.
//
// Hourly rather than overnight because the point (decision #8 in the plan) is
// same-day visibility: a Sales Lead watching the dashboard should see today's
// numbers climb through the day, not find out tomorrow.
//
// The window is today plus the previous two days, not just today. The CRM is a
// live operational system whose yesterday-numbers can still move (a booking
// confirmed late, a correction), and re-syncing is cheap and idempotent —
// every count is recomputed from the feed, never incremented.

const logger = createLogger("crm-sync");

/** How many days back each run re-pulls, to absorb late CRM corrections. */
const LOOKBACK_DAYS = 2;

function dateOnlyUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function toKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type CrmSyncResult = {
  skipped?: string;
  rows: number;
  matched: number;
  unmatched: number;
  employeesUpdated: number;
};

export async function runCrmSync(now: Date = new Date()): Promise<CrmSyncResult> {
  if (!crmConfigured()) {
    logger.warn("CRM not configured — skipping sync");
    return { skipped: "not-configured", rows: 0, matched: 0, unmatched: 0, employeesUpdated: 0 };
  }

  const to = dateOnlyUTC(now);
  const from = new Date(to.getTime() - LOOKBACK_DAYS * 86_400_000);

  let rows;
  try {
    rows = await fetchActivity(toKey(from), toKey(to));
  } catch (err) {
    // A CRM outage or an IP-allowlist rejection must not take the scheduler
    // down or leave half a window written. Log loudly and leave the last good
    // data in place — stale numbers beat wrong ones.
    if (err instanceof CrmSyncError) {
      logger.error("CRM fetch failed", { message: err.message, status: err.status });
    } else {
      logger.error("CRM fetch failed", { message: err instanceof Error ? err.message : String(err) });
    }
    throw err;
  }

  // Match against sales-side employees only. A tech employee who happens to
  // share a name with a rep must never absorb sales activity.
  const employees = await prisma.employee.findMany({
    where: { status: "active", role: { in: [...SALES_ROLES, Role.hr] } },
    select: { id: true, email: true, fullName: true },
  });
  const index = buildMatchIndex(employees);

  let matched = 0;
  let unmatched = 0;
  const touched = new Map<string, Set<string>>(); // employeeId -> date keys

  for (const row of rows) {
    const result = matchRow(row, index);
    if (result.employeeId) {
      matched += 1;
    } else {
      unmatched += 1;
      // Deliberately WARN, not debug: an unmatched rep means somebody's numbers
      // are going nowhere, and that should be visible without turning on debug
      // logging. The row is still persisted below so an admin can see it.
      logger.warn("unmatched CRM row", { email: row.email, name: row.name, reason: result.reason });
    }

    const date = new Date(`${row.date}T00:00:00.000Z`);
    await prisma.salesActivitySync.upsert({
      where: { crmEmail_date: { crmEmail: row.email, date } },
      create: {
        employeeId: result.employeeId,
        crmEmail: row.email,
        crmName: row.name,
        date,
        callsMade: row.callsMade,
        siteVisits: row.siteVisits,
        bookingsConfirmed: row.bookingsConfirmed,
        matchMethod: result.method,
      },
      update: {
        // Re-resolve the match on every sync: an admin who fixes an employee's
        // email should see previously-unmatched history attach itself on the
        // next run, without a manual backfill.
        employeeId: result.employeeId,
        crmName: row.name,
        callsMade: row.callsMade,
        siteVisits: row.siteVisits,
        bookingsConfirmed: row.bookingsConfirmed,
        matchMethod: result.method,
        syncedAt: new Date(),
      },
    });

    if (result.employeeId) {
      const set = touched.get(result.employeeId) ?? new Set<string>();
      set.add(row.date);
      touched.set(result.employeeId, set);
    }
  }

  // Write the synced numbers through into the WorkItems everything else reads.
  for (const [employeeId, dateKeys] of touched) {
    for (const key of dateKeys) {
      await syncEmployeeMetrics(employeeId, new Date(`${key}T00:00:00.000Z`));
    }
  }

  // Reps the feed said nothing about today still need their standing targets,
  // so a rep with a genuinely quiet morning shows "0 of 100" rather than no row
  // at all.
  await provisionSalesTargets(now);

  const result: CrmSyncResult = {
    rows: rows.length,
    matched,
    unmatched,
    employeesUpdated: touched.size,
  };
  logger.info("crm sync complete", result);
  return result;
}
