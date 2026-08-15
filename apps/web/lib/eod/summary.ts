import { prisma } from "@/lib/db/prisma";
import { WorkItemMode, WorkItemStatus } from "@prisma/client";
import { isMetricDepartment } from "@/lib/departments/type";

// Track A ↔ Track B integration (PRD §5.4). Derives an End-of-Day report for
// an employee on a given date from data that already exists — no new table.
//
// The day's plan comes from Track B's DailyTaskSelection (chosen at clock-in);
// outcomes come from the current WorkItem state plus the point-ledger rows
// credited *today*. This is a read-only summary — it never credits or mutates.
//
// Tiered review (Pillar 2, 2026-08-08): points are credited immediately for
// small tasks, but a task above the review threshold sits in `in_review` until
// a Lead accepts it — so it counts toward `inReviewCount` today and only lands
// in `completedCount`/`pointsEarnedToday` on the day it's accepted. That's
// deliberate: the day's point total means "points actually banked".

export type EodItem = {
  workItemId: string;
  title: string;
  mode: WorkItemMode;
  status: WorkItemStatus;
  taskPoints: number | null;
  targetValue: number | null;
  currentValue: number | null;
  completedToday: boolean;
  projectName: string;
  subUnitName: string;
  assignedAt: Date;
  completedAt: Date | null;
};

export type EodSummary = {
  date: string; // YYYY-MM-DD
  plannedCount: number;
  completedCount: number;
  /** Planned tasks handed in but not yet accepted by a Lead (Pillar 2). */
  inReviewCount: number;
  pointsEarnedToday: number;
  /** Sales/BD employees never credit EmployeePointLedger (metric-mode WorkItems
   *  score via attainment-%, not points) — callers use this to hide the point
   *  figure rather than showing a permanently-0 one. */
  isMetric: boolean;
  items: EodItem[];
};

/**
 * Build the derived EOD summary for `employeeId` on `date` (a @db.Date-aligned
 * UTC-midnight Date). Reused by POST /attendance/clock-out and
 * GET /attendance/eod.
 */
export async function buildEodSummary(
  employeeId: string,
  date: Date,
): Promise<EodSummary> {
  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const [selections, ledgerToday, employee] = await Promise.all([
    prisma.dailyTaskSelection.findMany({
      where: { employeeId, date: dayStart },
      include: { workItem: { include: { subUnit: { include: { workUnit: true } } } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.employeePointLedger.findMany({
      where: {
        employeeId,
        creditedAt: { gte: dayStart, lt: dayEnd },
      },
      select: { workItemId: true, points: true },
    }),
    prisma.employee.findUnique({
      where: { id: employeeId },
      select: { department: { select: { typeKey: true } } },
    }),
  ]);
  const isMetric = isMetricDepartment(employee?.department?.typeKey);

  const creditedTodayByItem = new Map<string, number>();
  for (const row of ledgerToday) {
    creditedTodayByItem.set(
      row.workItemId,
      (creditedTodayByItem.get(row.workItemId) ?? 0) + row.points,
    );
  }

  const items: EodItem[] = selections.map((s) => {
    const w = s.workItem;
    return {
      workItemId: w.id,
      title: w.title,
      mode: w.mode,
      status: w.status,
      taskPoints: w.taskPoints ?? null,
      targetValue: w.targetValue == null ? null : Number(w.targetValue),
      currentValue: w.currentValue == null ? null : Number(w.currentValue),
      completedToday: creditedTodayByItem.has(w.id),
      projectName: w.subUnit.workUnit.name,
      subUnitName: w.subUnit.name,
      assignedAt: w.createdAt,
      completedAt: w.completedAt,
    };
  });

  // A task credited today but not in today's plan (self-logged work, or a
  // task selected on an earlier day and finished today) still needs to show
  // up here — otherwise pointsEarnedToday is nonzero while items is empty,
  // which reads as a phantom number rather than "an unplanned task".
  const plannedItemIds = new Set(items.map((i) => i.workItemId));
  const unplannedItemIds = [...creditedTodayByItem.keys()].filter(
    (id) => !plannedItemIds.has(id),
  );
  if (unplannedItemIds.length > 0) {
    const unplannedWorkItems = await prisma.workItem.findMany({
      where: { id: { in: unplannedItemIds } },
      include: { subUnit: { include: { workUnit: true } } },
    });
    for (const w of unplannedWorkItems) {
      items.push({
        workItemId: w.id,
        title: w.title,
        mode: w.mode,
        status: w.status,
        taskPoints: w.taskPoints ?? null,
        targetValue: w.targetValue == null ? null : Number(w.targetValue),
        currentValue: w.currentValue == null ? null : Number(w.currentValue),
        completedToday: true,
        projectName: w.subUnit.workUnit.name,
        subUnitName: w.subUnit.name,
        assignedAt: w.createdAt,
        completedAt: w.completedAt,
      });
    }
  }

  // Self-logged tasks are never picked at clock-in, so they have no
  // DailyTaskSelection row — without this they'd stay invisible in "today's
  // plan" all the way through `pending`/`in_review`, only surfacing (via the
  // unplanned-credited block above) on the day a Lead happens to accept them,
  // which could be days later. Pull in today's self-logged items by
  // `dueDate` (self-log always sets it to the day logged) regardless of
  // status, so the employee's own EOD reflects "I logged and am waiting on
  // this" the same day.
  const coveredItemIds = new Set(items.map((i) => i.workItemId));
  const selfLoggedToday = await prisma.workItem.findMany({
    where: {
      assignedTo: employeeId,
      selfLogged: true,
      dueDate: dayStart,
      deletedAt: null,
      id: { notIn: [...coveredItemIds] },
    },
    include: { subUnit: { include: { workUnit: true } } },
  });
  for (const w of selfLoggedToday) {
    items.push({
      workItemId: w.id,
      title: w.title,
      mode: w.mode,
      status: w.status,
      taskPoints: w.taskPoints ?? null,
      targetValue: w.targetValue == null ? null : Number(w.targetValue),
      currentValue: w.currentValue == null ? null : Number(w.currentValue),
      completedToday: creditedTodayByItem.has(w.id),
      projectName: w.subUnit.workUnit.name,
      subUnitName: w.subUnit.name,
      assignedAt: w.createdAt,
      completedAt: w.completedAt,
    });
  }

  const completedCount = items.filter(
    (i) => i.status === WorkItemStatus.completed,
  ).length;
  const inReviewCount = items.filter(
    (i) => i.status === WorkItemStatus.in_review,
  ).length;

  // Points earned today across *all* ledger entries for the day, even if the
  // completed item wasn't in today's plan (e.g. finished an unplanned task) —
  // now always backed by a matching entry in `items` above.
  const pointsEarnedToday = Array.from(creditedTodayByItem.values()).reduce(
    (a, b) => a + b,
    0,
  );

  return {
    date: dayStart.toISOString().slice(0, 10),
    // Selected-at-clock-in tasks plus today's self-logged ones — both are
    // "today's work", just chosen a different way.
    plannedCount: items.length,
    completedCount,
    inReviewCount,
    pointsEarnedToday,
    isMetric,
    items,
  };
}
