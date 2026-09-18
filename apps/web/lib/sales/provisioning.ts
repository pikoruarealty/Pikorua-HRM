import { SalesMetric, WorkItemFrequency, WorkItemMode, WorkItemStatus } from "@prisma/client";
import { Role } from "@/lib/rbac";
import { prisma } from "@/lib/db/prisma";
import { createLogger } from "@/lib/log";
import { getSalesTargetConfig, resolveTargets } from "@/lib/sales/targets";

// Pillar 4 (2026-08-10) — auto-provisioning a sales rep's standing targets.
//
// The owner's requirement: "add a default task for the sales employees of 100
// calls everyday when they clock in so they don't have to select a different
// task everytime". A rep should never pick a task — it is the same task every
// day and the number fills itself in from the CRM.
//
// WorkItem.subUnitId is non-null, so the auto-created targets need somewhere to
// hang. Rather than invent a parallel "targets" concept outside the WorkUnit
// tree (which would fork every downstream reader — progress bars, scoring,
// team views), each sales department gets one well-known container WorkUnit and
// SubUnit, created on demand and then reused forever. Everything downstream
// keeps reading ordinary WorkItems and needs no special case.

const logger = createLogger("sales-provisioning");

export const SALES_CONTAINER_WORK_UNIT = "Sales Activity";
export const SALES_CONTAINER_SUB_UNIT = "Daily Targets";

export const SALES_ROLES: readonly Role[] = [Role.sales_employee, Role.sales_lead, Role.bde];

const METRIC_TITLES: Record<SalesMetric, string> = {
  [SalesMetric.calls]: "Calls",
  [SalesMetric.site_visits]: "Site visits",
  [SalesMetric.bookings]: "Bookings confirmed",
};

/**
 * The container SubUnit for a department, created on first use.
 *
 * The WorkUnit needs a projectLead; we use the department's sales lead when
 * there is one and fall back to the first active member, because the field is
 * non-null and this container is bookkeeping rather than a real project anybody
 * leads. Returns null when the department has nobody at all — there is then
 * nothing to provision for either.
 */
export async function ensureSalesContainer(departmentId: string): Promise<string | null> {
  const existing = await prisma.subUnit.findFirst({
    where: {
      name: SALES_CONTAINER_SUB_UNIT,
      deletedAt: null,
      workUnit: { departmentId, name: SALES_CONTAINER_WORK_UNIT, deletedAt: null },
    },
    select: { id: true },
  });
  if (existing) return existing.id;

  const lead =
    (await prisma.employee.findFirst({
      where: { departmentId, status: "active", role: Role.sales_lead },
      select: { id: true },
    })) ??
    (await prisma.employee.findFirst({
      where: { departmentId, status: "active" },
      select: { id: true },
    }));
  if (!lead) {
    logger.warn("cannot provision sales container — department has no active employees", { departmentId });
    return null;
  }

  const workUnit =
    (await prisma.workUnit.findFirst({
      where: { departmentId, name: SALES_CONTAINER_WORK_UNIT, deletedAt: null },
      select: { id: true },
    })) ??
    (await prisma.workUnit.create({
      data: {
        departmentId,
        name: SALES_CONTAINER_WORK_UNIT,
        description:
          "Auto-managed container for standing sales targets (calls, site visits, bookings). Numbers are synced from the CRM — do not edit by hand.",
        projectLeadId: lead.id,
      },
      select: { id: true },
    }));

  const subUnit = await prisma.subUnit.create({
    data: { workUnitId: workUnit.id, name: SALES_CONTAINER_SUB_UNIT },
    select: { id: true },
  });
  logger.info("provisioned sales container", { departmentId, subUnitId: subUnit.id });
  return subUnit.id;
}

type PeriodKey = { periodYear: number; periodMonth: number; periodDay: number | null };

/**
 * Find (or create) the WorkItem carrying one sales metric for one rep in one
 * period. This is the single place a CRM-fed WorkItem comes into existence, so
 * the sync and the rollover cron cannot drift into creating two rival rows.
 *
 * Idempotent: a second call in the same period returns the same row.
 *
 * Daily metrics (calls) are a standing counter, not a new row per day
 * (2026-09-18, owner request: "the calls won't [get] rolled over if not
 * completed — just reset the counter"). The full day-by-day call history
 * already lives in SalesActivitySync (crm-sync.ts persists it independently
 * of this WorkItem, and write-through.ts recomputes currentValue from it on
 * every sync), so a new row every day bought nothing but a rep's task list
 * filling up with stale, never-completed "Calls" rows for every day they
 * missed target. One row is kept per (rep, metric) and reset in place — same
 * id, target/currentValue/period refreshed — when the day rolls over. Monthly
 * metrics (site visits, bookings) are unaffected: a new row per month is the
 * correct cadence there, not a stacking bug.
 */
export async function ensureSalesWorkItem(args: {
  employeeId: string;
  departmentId: string;
  metric: SalesMetric;
  period: PeriodKey;
  targetValue: number;
}): Promise<string | null> {
  const { employeeId, metric, period, targetValue } = args;

  if (period.periodDay !== null) {
    const existing = await prisma.workItem.findFirst({
      where: { assignedTo: employeeId, mode: WorkItemMode.metric, salesMetric: metric, deletedAt: null },
      select: { id: true, periodYear: true, periodMonth: true, periodDay: true },
    });

    if (!existing) {
      const subUnitId = await ensureSalesContainer(args.departmentId);
      if (!subUnitId) return null;
      const created = await prisma.workItem.create({
        data: {
          subUnitId,
          assignedTo: employeeId,
          title: METRIC_TITLES[metric],
          mode: WorkItemMode.metric,
          salesMetric: metric,
          frequency: WorkItemFrequency.daily,
          targetValue,
          currentValue: 0,
          periodYear: period.periodYear,
          periodMonth: period.periodMonth,
          periodDay: period.periodDay,
          repeatDaily: true,
        },
        select: { id: true },
      });
      return created.id;
    }

    const isNewDay =
      existing.periodYear !== period.periodYear ||
      existing.periodMonth !== period.periodMonth ||
      existing.periodDay !== period.periodDay;
    if (isNewDay) {
      await prisma.workItem.update({
        where: { id: existing.id },
        data: {
          periodYear: period.periodYear,
          periodMonth: period.periodMonth,
          periodDay: period.periodDay,
          targetValue,
          currentValue: 0,
          status: WorkItemStatus.pending,
          completedAt: null,
        },
      });
    }
    return existing.id;
  }

  // Monthly metrics: one row per month, as before — a genuinely new period,
  // not a daily reset.
  const existing = await prisma.workItem.findFirst({
    where: {
      assignedTo: employeeId,
      mode: WorkItemMode.metric,
      salesMetric: metric,
      periodYear: period.periodYear,
      periodMonth: period.periodMonth,
      periodDay: period.periodDay,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (existing) return existing.id;

  const subUnitId = await ensureSalesContainer(args.departmentId);
  if (!subUnitId) return null;

  const created = await prisma.workItem.create({
    data: {
      subUnitId,
      assignedTo: employeeId,
      title: METRIC_TITLES[metric],
      mode: WorkItemMode.metric,
      salesMetric: metric,
      frequency: WorkItemFrequency.monthly,
      targetValue,
      currentValue: 0,
      periodYear: period.periodYear,
      periodMonth: period.periodMonth,
      periodDay: period.periodDay,
      repeatDaily: false,
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Ensure every active sales rep has today's calls row and this month's site-visit
 * and booking rows, at their resolved targets. Safe to call repeatedly — it is
 * driven by the rollover cron and again by each CRM sync, so a rep hired
 * mid-month starts being tracked within the hour rather than the next morning.
 */
export async function provisionSalesTargets(now: Date = new Date()): Promise<{
  employees: number;
  created: number;
}> {
  const config = await getSalesTargetConfig(now);
  if (!config.autoAssignDailyCalls) {
    logger.debug("auto-assign disabled — skipping provisioning");
    return { employees: 0, created: 0 };
  }

  const reps = await prisma.employee.findMany({
    where: { status: "active", role: { in: [...SALES_ROLES] }, departmentId: { not: null } },
    select: {
      id: true,
      departmentId: true,
      dailyCallTarget: true,
      monthlySiteVisitTarget: true,
      monthlyBookingTarget: true,
    },
  });

  const periodYear = now.getUTCFullYear();
  const periodMonth = now.getUTCMonth() + 1;
  const periodDay = now.getUTCDate();

  let created = 0;
  for (const rep of reps) {
    if (!rep.departmentId) continue;
    const targets = resolveTargets(rep, config);

    const wanted: { metric: SalesMetric; period: PeriodKey; targetValue: number }[] = [
      {
        metric: SalesMetric.calls,
        period: { periodYear, periodMonth, periodDay },
        targetValue: targets.dailyCallTarget,
      },
      {
        metric: SalesMetric.site_visits,
        period: { periodYear, periodMonth, periodDay: null },
        targetValue: targets.monthlySiteVisitTarget,
      },
      {
        metric: SalesMetric.bookings,
        period: { periodYear, periodMonth, periodDay: null },
        targetValue: targets.monthlyBookingTarget,
      },
    ];

    for (const w of wanted) {
      const before = await prisma.workItem.count({
        where: {
          assignedTo: rep.id,
          salesMetric: w.metric,
          periodYear: w.period.periodYear,
          periodMonth: w.period.periodMonth,
          periodDay: w.period.periodDay,
          deletedAt: null,
        },
      });
      const id = await ensureSalesWorkItem({
        employeeId: rep.id,
        departmentId: rep.departmentId,
        metric: w.metric,
        period: w.period,
        targetValue: w.targetValue,
      });
      if (id && before === 0) created += 1;
    }
  }

  logger.info("provisioned sales targets", { employees: reps.length, created });
  return { employees: reps.length, created };
}
