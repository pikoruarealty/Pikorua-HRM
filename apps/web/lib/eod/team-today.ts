import { prisma } from "@/lib/db/prisma";
import { WorkItemStatus } from "@prisma/client";
import type { EodItem } from "@/lib/eod/summary";
import { isMetricDepartment } from "@/lib/departments/type";

// Batched (3-query, not N+1) equivalent of buildEodSummary for many employees
// at once — backs GET /attendance/task-progress, the Lead/Admin "what is
// everyone doing right now" live view. Mirrors buildEodSummary's grouping
// logic but scoped across a set of employees instead of one.

export type TeamTodayRow = {
  employeeId: string;
  fullName: string;
  photoUrl: string | null;
  clockIn: Date | null;
  clockOut: Date | null;
  plannedCount: number;
  completedCount: number;
  /** Planned tasks handed in but not yet accepted by a Lead (Pillar 2). */
  inReviewCount: number;
  pointsEarnedToday: number;
  isMetric: boolean;
  items: EodItem[];
};

export async function buildTeamTodaySummary(
  employeeIds: string[],
  date: Date,
): Promise<TeamTodayRow[]> {
  if (employeeIds.length === 0) return [];

  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const [employees, records, selections, ledgerToday, selfLoggedToday] = await Promise.all([
    prisma.employee.findMany({
      where: { id: { in: employeeIds } },
      select: { id: true, fullName: true, photoUrl: true, department: { select: { typeKey: true } } },
      orderBy: { fullName: "asc" },
    }),
    prisma.attendanceRecord.findMany({
      where: { employeeId: { in: employeeIds }, date: dayStart },
    }),
    prisma.dailyTaskSelection.findMany({
      where: { employeeId: { in: employeeIds }, date: dayStart },
      include: { workItem: { include: { subUnit: { include: { workUnit: true } } } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.employeePointLedger.findMany({
      where: { employeeId: { in: employeeIds }, creditedAt: { gte: dayStart, lt: dayEnd } },
      select: { employeeId: true, workItemId: true, points: true },
    }),
    // Self-logged tasks have no DailyTaskSelection row, so without this a Lead
    // watching this live view has no way to see one exists until it's been
    // accepted — see the identical fix in buildEodSummary.
    prisma.workItem.findMany({
      where: { assignedTo: { in: employeeIds }, selfLogged: true, dueDate: dayStart, deletedAt: null },
      include: { subUnit: { include: { workUnit: true } } },
    }),
  ]);

  // A task credited today but not in today's plan (self-logged work, etc.)
  // still needs a matching `items` entry — see the identical fix + rationale
  // in buildEodSummary (lib/eod/summary.ts).
  const plannedItemIds = new Set(selections.map((s) => s.workItemId));
  const unplannedItemIds = [
    ...new Set(
      ledgerToday
        .map((r) => r.workItemId)
        .filter((id) => !plannedItemIds.has(id)),
    ),
  ];
  const unplannedWorkItems =
    unplannedItemIds.length > 0
      ? await prisma.workItem.findMany({
          where: { id: { in: unplannedItemIds } },
          include: { subUnit: { include: { workUnit: true } } },
        })
      : [];
  const unplannedByEmployee = new Map<string, typeof unplannedWorkItems>();
  if (unplannedWorkItems.length > 0) {
    const employeeIdByItem = new Map(
      ledgerToday.map((r) => [r.workItemId, r.employeeId]),
    );
    for (const w of unplannedWorkItems) {
      const empId = employeeIdByItem.get(w.id);
      if (!empId) continue;
      const list = unplannedByEmployee.get(empId) ?? [];
      list.push(w);
      unplannedByEmployee.set(empId, list);
    }
  }

  const selfLoggedByEmployee = new Map<string, typeof selfLoggedToday>();
  for (const w of selfLoggedToday) {
    if (!w.assignedTo) continue;
    const list = selfLoggedByEmployee.get(w.assignedTo) ?? [];
    list.push(w);
    selfLoggedByEmployee.set(w.assignedTo, list);
  }

  const recordByEmployee = new Map(records.map((r) => [r.employeeId, r]));

  const selectionsByEmployee = new Map<string, typeof selections>();
  for (const s of selections) {
    const list = selectionsByEmployee.get(s.employeeId) ?? [];
    list.push(s);
    selectionsByEmployee.set(s.employeeId, list);
  }

  // creditedTodayByItem, scoped per employee (a workItemId is only ever
  // assigned to one employee, but keying by employee avoids any ambiguity).
  const creditedTodayByEmployeeItem = new Map<string, Map<string, number>>();
  for (const row of ledgerToday) {
    const byItem = creditedTodayByEmployeeItem.get(row.employeeId) ?? new Map<string, number>();
    byItem.set(row.workItemId, (byItem.get(row.workItemId) ?? 0) + row.points);
    creditedTodayByEmployeeItem.set(row.employeeId, byItem);
  }

  return employees.map((e) => {
    const record = recordByEmployee.get(e.id);
    const empSelections = selectionsByEmployee.get(e.id) ?? [];
    const creditedTodayByItem = creditedTodayByEmployeeItem.get(e.id) ?? new Map<string, number>();

    const items: EodItem[] = empSelections.map((s) => {
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
    for (const w of unplannedByEmployee.get(e.id) ?? []) {
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
    const coveredItemIds = new Set(items.map((i) => i.workItemId));
    for (const w of selfLoggedByEmployee.get(e.id) ?? []) {
      if (coveredItemIds.has(w.id)) continue;
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

    const completedCount = items.filter((i) => i.status === WorkItemStatus.completed).length;
    const inReviewCount = items.filter((i) => i.status === WorkItemStatus.in_review).length;
    const pointsEarnedToday = Array.from(creditedTodayByItem.values()).reduce((a, b) => a + b, 0);

    return {
      employeeId: e.id,
      fullName: e.fullName,
      photoUrl: e.photoUrl ? `/api/v1/employees/${e.id}/photo` : null,
      clockIn: record?.clockInRaw ?? null,
      clockOut: record?.clockOutRaw ?? null,
      // Selected-at-clock-in tasks plus today's self-logged ones — see the
      // identical rationale in buildEodSummary.
      plannedCount: items.length,
      completedCount,
      inReviewCount,
      pointsEarnedToday,
      isMetric: isMetricDepartment(e.department?.typeKey),
      items,
    };
  });
}
