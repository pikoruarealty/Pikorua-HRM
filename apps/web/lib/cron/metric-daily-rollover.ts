import { prisma } from "@/lib/db/prisma";
import { WorkItemFrequency, WorkItemMode } from "@prisma/client";

// Track B — Daily metric tasks are "a new row per day" (mirrors the existing
// manual monthly-per-period pattern, just automated — nobody will manually
// create a fresh row every single day the way Leads do monthly). Runs once
// daily (scheduler.ts, before the recognition jobs) and clones the most
// recent non-deleted daily-frequency row per (subUnitId, assignedTo) forward
// to today, if today's row doesn't already exist. A Lead soft-deleting the
// latest row stops the chain (it's filtered out of the "non-deleted" query)
// — no separate "template" concept needed.

function todayUTC(): { year: number; month: number; day: number } {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
}

export async function runMetricDailyRollover(): Promise<{ created: number }> {
  const { year, month, day } = todayUTC();

  const dailyItems = await prisma.workItem.findMany({
    where: { mode: WorkItemMode.metric, frequency: WorkItemFrequency.daily, deletedAt: null },
    orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }, { periodDay: "desc" }],
  });

  // Latest row per (subUnitId, assignedTo) — the query above is already
  // ordered newest-first, so the first occurrence per key is the latest.
  const latestByKey = new Map<string, (typeof dailyItems)[number]>();
  for (const item of dailyItems) {
    const key = `${item.subUnitId}:${item.assignedTo}`;
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
        mode: WorkItemMode.metric,
        frequency: WorkItemFrequency.daily,
        targetValue: item.targetValue,
        currentValue: 0,
        periodYear: year,
        periodMonth: month,
        periodDay: day,
      },
    });
    created += 1;
  }

  return { created };
}
