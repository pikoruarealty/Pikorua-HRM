import { OfflineClaimStatus, SalesMetric } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { createLogger } from "@/lib/log";
import { ensureSalesWorkItem } from "@/lib/sales/provisioning";
import { getSalesTargetConfig, resolveTargets } from "@/lib/sales/targets";

// Pillar 4 (2026-08-10) — pushing synced CRM numbers into the WorkItems the
// rest of the system already reads.
//
// The plan's rule, kept strictly: there is NO parallel code path for sales
// numbers. Progress bars, the composite score and the team dashboard all read
// WorkItem.currentValue exactly as they would for a hand-entered figure. This
// module is the only writer.
//
// The day's call count is recomputed from scratch on every sync as
//   CRM calls for the day  +  sum of APPROVED offline claims for the day
// rather than incremented. Recomputation makes a re-sync, a late CRM
// correction, and a claim approved hours after the fact all converge on the
// same answer, where increments would double-count.
//
// Offline claims stay individually queryable (OfflineActivityClaim rows) so the
// UI can show "82 from CRM + 15 approved offline" instead of an unexplained 97.

const logger = createLogger("sales-write-through");

function monthBounds(date: Date): { start: Date; endExclusive: Date } {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  return { start: new Date(Date.UTC(y, m, 1)), endExclusive: new Date(Date.UTC(y, m + 1, 1)) };
}

export type CallBreakdown = { crm: number; offline: number; total: number };

/** The day's call total, split by source. Exported because the dashboard shows
 *  the split, and the split is the whole anti-gaming point. */
export async function callBreakdownForDay(employeeId: string, date: Date): Promise<CallBreakdown> {
  const [sync, claims] = await Promise.all([
    prisma.salesActivitySync.findFirst({
      where: { employeeId, date },
      select: { callsMade: true },
    }),
    prisma.offlineActivityClaim.aggregate({
      where: { employeeId, date, status: OfflineClaimStatus.approved },
      _sum: { calls: true },
    }),
  ]);
  const crm = sync?.callsMade ?? 0;
  const offline = claims._sum.calls ?? 0;
  return { crm, offline, total: crm + offline };
}

/**
 * Recompute and persist one rep's metric WorkItems for the given day (and the
 * month that day falls in).
 *
 * `date` is a date-only UTC midnight, matching how attendance and the CRM feed
 * both key their days.
 */
export async function syncEmployeeMetrics(employeeId: string, date: Date): Promise<void> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      departmentId: true,
      dailyCallTarget: true,
      monthlySiteVisitTarget: true,
      monthlyBookingTarget: true,
    },
  });
  if (!employee?.departmentId) {
    logger.warn("skipping write-through — employee has no department", { employeeId });
    return;
  }

  const config = await getSalesTargetConfig(date);
  const targets = resolveTargets(employee, config);

  const periodYear = date.getUTCFullYear();
  const periodMonth = date.getUTCMonth() + 1;
  const periodDay = date.getUTCDate();

  // --- Daily calls -------------------------------------------------------
  const calls = await callBreakdownForDay(employeeId, date);
  const callsItemId = await ensureSalesWorkItem({
    employeeId,
    departmentId: employee.departmentId,
    metric: SalesMetric.calls,
    period: { periodYear, periodMonth, periodDay },
    targetValue: targets.dailyCallTarget,
  });
  if (callsItemId) {
    await prisma.workItem.update({
      where: { id: callsItemId },
      data: { currentValue: calls.total },
    });
  }

  // --- Monthly outcomes --------------------------------------------------
  // Summed across the whole month's sync rows rather than incremented, for the
  // same idempotency reason as above.
  const { start, endExclusive } = monthBounds(date);
  const monthTotals = await prisma.salesActivitySync.aggregate({
    where: { employeeId, date: { gte: start, lt: endExclusive } },
    _sum: { siteVisits: true, bookingsConfirmed: true },
  });

  const outcomes: { metric: SalesMetric; value: number; target: number }[] = [
    {
      metric: SalesMetric.site_visits,
      value: monthTotals._sum.siteVisits ?? 0,
      target: targets.monthlySiteVisitTarget,
    },
    {
      metric: SalesMetric.bookings,
      value: monthTotals._sum.bookingsConfirmed ?? 0,
      target: targets.monthlyBookingTarget,
    },
  ];

  for (const o of outcomes) {
    const itemId = await ensureSalesWorkItem({
      employeeId,
      departmentId: employee.departmentId,
      metric: o.metric,
      period: { periodYear, periodMonth, periodDay: null },
      targetValue: o.target,
    });
    if (itemId) {
      await prisma.workItem.update({ where: { id: itemId }, data: { currentValue: o.value } });
    }
  }

  logger.debug("wrote through sales metrics", {
    employeeId,
    date: date.toISOString().slice(0, 10),
    calls: calls.total,
    siteVisits: monthTotals._sum.siteVisits ?? 0,
    bookings: monthTotals._sum.bookingsConfirmed ?? 0,
  });
}
