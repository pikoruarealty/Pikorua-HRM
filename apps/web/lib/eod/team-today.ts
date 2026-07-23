import { prisma } from "@/lib/db/prisma";
import { WorkItemStatus } from "@prisma/client";
import type { EodItem } from "@/lib/eod/summary";

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
  pointsEarnedToday: number;
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

  const [employees, records, selections, ledgerToday] = await Promise.all([
    prisma.employee.findMany({
      where: { id: { in: employeeIds } },
      select: { id: true, fullName: true, photoUrl: true },
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
  ]);

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

    const completedCount = items.filter((i) => i.status === WorkItemStatus.completed).length;
    const pointsEarnedToday = Array.from(creditedTodayByItem.values()).reduce((a, b) => a + b, 0);

    return {
      employeeId: e.id,
      fullName: e.fullName,
      photoUrl: e.photoUrl ? `/api/v1/employees/${e.id}/photo` : null,
      clockIn: record?.clockInRaw ?? null,
      clockOut: record?.clockOutRaw ?? null,
      plannedCount: items.length,
      completedCount,
      pointsEarnedToday,
      items,
    };
  });
}
