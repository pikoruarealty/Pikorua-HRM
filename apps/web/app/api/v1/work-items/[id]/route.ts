import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { Prisma, WorkItemMode, WorkItemStatus } from "@prisma/client";

// Track B. PATCH /api/v1/work-items/:id — Milestone 1.2 (atomic) + 2.2 (metric).

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  assignedTo: z.string().uuid().optional(),
  taskPoints: z.number().int().positive().optional(),
  targetValue: z.number().positive().optional(),
  currentValue: z.number().min(0).optional(),
  status: z.nativeEnum(WorkItemStatus).optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const workItem = await prisma.workItem.findUnique({
    where: { id: params.id },
    include: { subUnit: { include: { workUnit: true } } },
  });
  if (!workItem) return failFor(ErrorCode.NOT_FOUND);

  const role = session.role;
  const isOwningLead = isLeadRole(role) && session.employeeId === workItem.subUnit.workUnit.teamLeadId;
  const isAssignee = session.employeeId === workItem.assignedTo;
  const canEditAll = isFinanceRole(role) || isOwningLead;

  if (!canEditAll && !isAssignee) {
    return failFor(ErrorCode.FORBIDDEN);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return failFor(ErrorCode.VALIDATION, "Invalid request body.");
  }
  const { title, assignedTo, taskPoints, targetValue, currentValue, status } = parsed.data;
  const isMetric = workItem.mode === WorkItemMode.metric;

  if (targetValue !== undefined && !isMetric) {
    return failFor(ErrorCode.VALIDATION, "targetValue only applies to metric-mode WorkItems.");
  }
  if (currentValue !== undefined && !isMetric) {
    return failFor(ErrorCode.VALIDATION, "currentValue only applies to metric-mode WorkItems.");
  }
  if (taskPoints !== undefined && isMetric) {
    return failFor(ErrorCode.VALIDATION, "taskPoints only applies to atomic-mode WorkItems.");
  }

  if (!canEditAll) {
    // Assigned Employee: status only (atomic) or currentValue only (metric).
    if (title !== undefined || assignedTo !== undefined || taskPoints !== undefined || targetValue !== undefined) {
      return failFor(ErrorCode.FORBIDDEN, "You can only update this task's progress.");
    }
    if (isMetric && status !== undefined) {
      return failFor(ErrorCode.FORBIDDEN, "Metric-mode status is derived from currentValue, not set directly.");
    }
  }

  if (assignedTo) {
    const assignee = await prisma.employee.findUnique({ where: { id: assignedTo } });
    if (!assignee) {
      return failFor(ErrorCode.VALIDATION, "assignedTo does not reference an existing employee.");
    }
    if (isOwningLead && !isFinanceRole(role)) {
      // A Lead may lead more than one team — the assignee must belong to any of
      // them, or be the Lead themselves (matches assignable-members' scope).
      const ownTeams = await prisma.team.findMany({
        where: { teamLeadId: session.employeeId },
        select: { id: true },
      });
      const ownTeamIds = new Set(ownTeams.map((t) => t.id));
      const inOwnTeam = assignee.teamId != null && ownTeamIds.has(assignee.teamId);
      const isSelf = assignee.id === session.employeeId;
      if (!inOwnTeam && !isSelf) {
        return failFor(ErrorCode.VALIDATION, "Leads can only assign WorkItems to their own team's members.");
      }
    }
  }

  if (isMetric) {
    const effectiveTarget = targetValue ?? Number(workItem.targetValue);
    const effectiveCurrent = currentValue ?? Number(workItem.currentValue);
    const nowCompleted = effectiveCurrent >= effectiveTarget;
    const wasCompleted = workItem.status === WorkItemStatus.completed;

    const updated = await prisma.workItem.update({
      where: { id: params.id },
      data: {
        title,
        assignedTo,
        targetValue,
        currentValue,
        status: nowCompleted ? WorkItemStatus.completed : WorkItemStatus.wip,
        completedAt: nowCompleted && !wasCompleted ? new Date() : nowCompleted ? undefined : null,
      },
    });
    return ok(updated);
  }

  const wasCompleted = workItem.status === WorkItemStatus.completed;
  const nowCompleted = status === WorkItemStatus.completed;
  const completingNow = nowCompleted && !wasCompleted;

  // Completion always credits task_points to the ledger, regardless of whether
  // it happens here or via POST /work-items/:id/complete. The ledger's
  // unique(work_item_id) constraint guarantees at most one credit even if this
  // route races the other one — the losing transaction rolls back (P2002) and
  // we surface a conflict instead of double-crediting.
  if (completingNow) {
    try {
      const [updatedItem] = await prisma.$transaction([
        prisma.workItem.update({
          where: { id: params.id },
          data: { title, assignedTo, taskPoints, status, completedAt: new Date() },
        }),
        prisma.employeePointLedger.create({
          data: {
            employeeId: assignedTo ?? workItem.assignedTo,
            workItemId: workItem.id,
            points: taskPoints ?? workItem.taskPoints!,
          },
        }),
      ]);
      return ok(updatedItem);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return failFor(ErrorCode.CONFLICT, "This task is already completed.");
      }
      throw err;
    }
  }

  const updated = await prisma.workItem.update({
    where: { id: params.id },
    data: {
      title,
      assignedTo,
      taskPoints,
      status,
      completedAt: status && !nowCompleted ? null : undefined,
    },
  });

  return ok(updated);
}
