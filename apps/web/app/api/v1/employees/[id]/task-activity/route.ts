import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";

// GET /api/v1/employees/:id/task-activity?period=daily|weekly|monthly|total&date=YYYY-MM-DD
// General task-activity history for an employee — which tasks they worked on
// (project/sub-unit, when assigned, when completed) over a period, for the
// Lead/Admin "how has this person been doing" view + self. Distinct from
// employees/:id/work-items/history, which is metric-mode growth tracking only.
//
// RBAC mirrors work-items/history/route.ts: self, the owning Lead (via the
// employee's own team's teamLeadId), or Finance (Admin/HR).

const PERIODS = ["daily", "weekly", "monthly", "total"] as const;
type Period = (typeof PERIODS)[number];

const querySchema = z.object({
  period: z.enum(PERIODS).optional().default("daily"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function resolveRange(period: Period, anchor: Date, joinedAt: Date): { from: Date; to: Date } {
  const from = new Date(anchor);
  const to = new Date(anchor);
  to.setUTCDate(to.getUTCDate() + 1);

  if (period === "daily") {
    return { from, to };
  }
  if (period === "weekly") {
    // Monday-start week containing anchor.
    const dow = from.getUTCDay(); // 0 = Sunday
    const diffToMonday = dow === 0 ? 6 : dow - 1;
    from.setUTCDate(from.getUTCDate() - diffToMonday);
    to.setTime(from.getTime());
    to.setUTCDate(to.getUTCDate() + 7);
    return { from, to };
  }
  if (period === "monthly") {
    from.setUTCDate(1);
    to.setTime(from.getTime());
    to.setUTCMonth(to.getUTCMonth() + 1);
    return { from, to };
  }
  // total
  return { from: joinedAt, to };
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const employee = await prisma.employee.findUnique({
    where: { id: params.id },
    include: { team: true },
  });
  if (!employee) return failFor(ErrorCode.NOT_FOUND);

  const role = session.role;
  const isSelf = session.employeeId === employee.id;
  const isOwningLead = isLeadRole(role) && session.employeeId === employee.team?.teamLeadId;
  if (!isFinanceRole(role) && !isOwningLead && !isSelf) {
    return failFor(ErrorCode.FORBIDDEN);
  }

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return failFor(ErrorCode.VALIDATION, "Invalid query parameters.");
  }
  const { period, date: dateParam } = parsed.data;

  const anchor = dateParam ? new Date(`${dateParam}T00:00:00.000Z`) : new Date();
  anchor.setUTCHours(0, 0, 0, 0);
  if (Number.isNaN(anchor.getTime())) {
    return failFor(ErrorCode.VALIDATION, "date is not a valid calendar date.");
  }
  const joinedAt = new Date(employee.dateOfJoining);
  joinedAt.setUTCHours(0, 0, 0, 0);

  const { from, to } = resolveRange(period, anchor, joinedAt);

  const [selections, ledger] = await Promise.all([
    prisma.dailyTaskSelection.findMany({
      where: { employeeId: employee.id, date: { gte: from, lt: to } },
      include: { workItem: { include: { subUnit: { include: { workUnit: true } } } } },
    }),
    prisma.employeePointLedger.findMany({
      where: { employeeId: employee.id, creditedAt: { gte: from, lt: to } },
      select: { workItemId: true, points: true },
    }),
  ]);

  const daysSelectedByItem = new Map<string, Set<string>>();
  const workItemById = new Map<string, (typeof selections)[number]["workItem"]>();
  for (const s of selections) {
    workItemById.set(s.workItemId, s.workItem);
    const days = daysSelectedByItem.get(s.workItemId) ?? new Set<string>();
    days.add(s.date.toISOString().slice(0, 10));
    daysSelectedByItem.set(s.workItemId, days);
  }

  const pointsByItem = new Map<string, number>();
  for (const l of ledger) {
    pointsByItem.set(l.workItemId, (pointsByItem.get(l.workItemId) ?? 0) + l.points);
  }

  // A task can appear via a ledger credit without a same-period selection row
  // (e.g. completed today from a selection made yesterday) — fetch any such
  // WorkItems not already covered by `selections`.
  const missingItemIds = [...pointsByItem.keys()].filter((id) => !workItemById.has(id));
  if (missingItemIds.length > 0) {
    const missingItems = await prisma.workItem.findMany({
      where: { id: { in: missingItemIds } },
      include: { subUnit: { include: { workUnit: true } } },
    });
    for (const w of missingItems) workItemById.set(w.id, w);
  }

  const touchedItemIds = new Set<string>([...daysSelectedByItem.keys(), ...pointsByItem.keys()]);

  const tasks = [...touchedItemIds]
    .map((workItemId) => {
      const w = workItemById.get(workItemId);
      if (!w) return null;
      return {
        workItemId: w.id,
        title: w.title,
        projectName: w.subUnit.workUnit.name,
        subUnitName: w.subUnit.name,
        mode: w.mode,
        status: w.status,
        taskPoints: w.taskPoints ?? null,
        assignedAt: w.createdAt,
        completedAt: w.completedAt,
        daysSelectedInPeriod: daysSelectedByItem.get(workItemId)?.size ?? 0,
        pointsEarnedInPeriod: pointsByItem.get(workItemId) ?? 0,
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null)
    .sort((a, b) => b.assignedAt.getTime() - a.assignedAt.getTime());

  const daysActiveInPeriod = new Set(selections.map((s) => s.date.toISOString().slice(0, 10))).size;
  const tasksCompletedInPeriod = tasks.filter(
    (t) => t.completedAt && t.completedAt >= from && t.completedAt < to,
  ).length;
  const pointsEarnedInPeriod = [...pointsByItem.values()].reduce((a, b) => a + b, 0);

  return ok({
    summary: {
      period,
      from: from.toISOString().slice(0, 10),
      to: new Date(to.getTime() - 1).toISOString().slice(0, 10),
      tasksTouched: tasks.length,
      tasksCompletedInPeriod,
      pointsEarnedInPeriod,
      daysActiveInPeriod,
    },
    tasks,
  });
}
