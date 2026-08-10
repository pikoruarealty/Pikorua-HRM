import { prisma } from "@/lib/db/prisma";
import { WorkItemFrequency, WorkItemMode, WorkItemStatus } from "@prisma/client";
import { createLogger } from "@/lib/log";
import { provisionSalesTargets } from "@/lib/sales/provisioning";

// Daily rollover of recurring work. Runs once daily (scheduler.ts, 00:10 UTC,
// before the CRM sync at :15 so a rep's calls row exists before anything tries
// to write into it).
//
// Two kinds of recurrence, one job:
//
//  1. METRIC daily-frequency items — "a new row per day" (mirrors the manual
//     monthly-per-period pattern, just automated; nobody will hand-create a
//     fresh row every single day the way Leads do monthly). Clones the most
//     recent non-deleted row per (subUnitId, assignedTo) forward to today.
//
//  2. ATOMIC items flagged `repeatDaily` (2026-08-10, owner request: "for the
//     other departments also like bde when any task is added give option to
//     make it a daily task until undone"). A standing chore — follow up leads,
//     update the pipeline sheet — reappears each morning as a fresh pending
//     task instead of being one task nobody can mark done twice.
//
// Stopping a chain is the same gesture for both: clear the flag on the newest
// row, or soft-delete it. The newest row is what the job looks at, so either
// breaks the chain — no separate "template" object to hunt down.
//
// Idempotent throughout: a second run on the same day creates nothing.

const logger = createLogger("metric-daily-rollover");

function todayUTC(): { year: number; month: number; day: number } {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
}

async function rollMetricItems(year: number, month: number, day: number): Promise<number> {
  const dailyItems = await prisma.workItem.findMany({
    where: { mode: WorkItemMode.metric, frequency: WorkItemFrequency.daily, deletedAt: null },
    orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }, { periodDay: "desc" }],
  });

  // Latest row per (subUnitId, assignedTo, salesMetric) — the query above is
  // already ordered newest-first, so the first occurrence per key is the
  // latest. salesMetric is part of the key because a rep can hold several
  // CRM-fed daily metrics in the same container SubUnit, and collapsing them
  // to one key would roll only one of them forward.
  const latestByKey = new Map<string, (typeof dailyItems)[number]>();
  for (const item of dailyItems) {
    const key = `${item.subUnitId}:${item.assignedTo}:${item.salesMetric ?? "-"}`;
    if (!latestByKey.has(key)) latestByKey.set(key, item);
  }

  let created = 0;
  for (const item of latestByKey.values()) {
    if (item.periodYear === year && item.periodMonth === month && item.periodDay === day) {
      continue; // already have today's row
    }

    const exists = await prisma.workItem.findFirst({
      where: {
        subUnitId: item.subUnitId,
        assignedTo: item.assignedTo,
        mode: WorkItemMode.metric,
        frequency: WorkItemFrequency.daily,
        salesMetric: item.salesMetric,
        periodYear: year,
        periodMonth: month,
        periodDay: day,
      },
    });
    if (exists) continue; // idempotent against a double run

    await prisma.workItem.create({
      data: {
        subUnitId: item.subUnitId,
        assignedTo: item.assignedTo,
        title: item.title,
        description: item.description,
        mode: WorkItemMode.metric,
        frequency: WorkItemFrequency.daily,
        salesMetric: item.salesMetric,
        repeatDaily: item.repeatDaily,
        targetValue: item.targetValue,
        currentValue: 0,
        periodYear: year,
        periodMonth: month,
        periodDay: day,
      },
    });
    created += 1;
  }
  return created;
}

async function rollAtomicItems(year: number, month: number, day: number): Promise<number> {
  const todayStart = new Date(Date.UTC(year, month - 1, day));
  const tomorrow = new Date(todayStart.getTime() + 86_400_000);

  const items = await prisma.workItem.findMany({
    where: { mode: WorkItemMode.atomic, repeatDaily: true, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });

  // Atomic items carry no period columns, so the recurrence chain is keyed by
  // what actually identifies a standing chore to a Lead: who does it, where it
  // lives, and what it's called. Renaming the newest row starts a new chain and
  // retires the old one, which is the intuitive result.
  const latestByKey = new Map<string, (typeof items)[number]>();
  for (const item of items) {
    const key = `${item.subUnitId}:${item.assignedTo}:${item.title}`;
    if (!latestByKey.has(key)) latestByKey.set(key, item);
  }

  let created = 0;
  for (const item of latestByKey.values()) {
    if (item.createdAt >= todayStart && item.createdAt < tomorrow) {
      continue; // today's instance already exists (created by the job, or by hand today)
    }

    await prisma.workItem.create({
      data: {
        subUnitId: item.subUnitId,
        assignedTo: item.assignedTo,
        title: item.title,
        description: item.description,
        mode: WorkItemMode.atomic,
        taskPoints: item.taskPoints,
        // A recurring daily task is due the day it appears — carrying the
        // original's due date forward would make every instance instantly
        // overdue and poison the timeliness component of the score.
        dueDate: todayStart,
        repeatDaily: true,
        selfLogged: item.selfLogged,
        adhocTypeId: item.adhocTypeId,
        status: WorkItemStatus.pending,
      },
    });
    created += 1;
  }
  return created;
}

export async function runMetricDailyRollover(): Promise<{
  created: number;
  atomicCreated: number;
  salesProvisioned: number;
}> {
  const { year, month, day } = todayUTC();

  const created = await rollMetricItems(year, month, day);
  const atomicCreated = await rollAtomicItems(year, month, day);
  // Sales reps' standing targets are provisioned rather than cloned: a new hire
  // has no previous row to roll forward from, and their targets come from
  // config, not from yesterday.
  const sales = await provisionSalesTargets();

  const result = { created, atomicCreated, salesProvisioned: sales.created };
  logger.info("daily rollover complete", result);
  return result;
}
