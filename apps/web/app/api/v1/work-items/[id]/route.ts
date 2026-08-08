import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole, rolesAtOrBelow } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { Prisma, WorkItemMode, WorkItemStatus } from "@prisma/client";
import { isClockedInNow } from "@/lib/attendance/status";

// Track B. PATCH/DELETE /api/v1/work-items/:id — Milestone 1.2 (atomic) + 2.2 (metric).

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  // Acceptance criteria + Lead-set due date (Pillar 1). Management-only, like
  // title/points — an assignee can still only move their own progress.
  description: z.string().max(2000).nullable().optional(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "dueDate must be YYYY-MM-DD")
    .nullable()
    .optional(),
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
  if (!workItem || workItem.deletedAt) return failFor(ErrorCode.NOT_FOUND);

  const role = session.role;
  const isProjectLead = session.employeeId === workItem.subUnit.workUnit.projectLeadId;
  const isAssignee = session.employeeId === workItem.assignedTo;
  const canEditAll = isFinanceRole(role) || isProjectLead;

  if (!canEditAll && !isAssignee) {
    return failFor(ErrorCode.FORBIDDEN);
  }
  // Self-service updates (assignee marking their own progress) require the
  // assignee to be currently clocked in; Lead/Admin management edits are
  // unaffected — they aren't the assignee's own moment-to-moment work.
  if (!canEditAll && !(await isClockedInNow(session.employeeId!))) {
    return fail(ErrorCode.VALIDATION, "You must be clocked in to update your tasks.", 422);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return failFor(
      ErrorCode.VALIDATION,
      issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "Invalid request body.",
    );
  }
  const { title, assignedTo, taskPoints, targetValue, currentValue, status } = parsed.data;
  // `undefined` = field untouched (Prisma skips it); explicit `null`/"" = clear it.
  const description =
    parsed.data.description === undefined ? undefined : parsed.data.description?.trim() || null;
  const dueDate =
    parsed.data.dueDate === undefined
      ? undefined
      : parsed.data.dueDate
        ? new Date(`${parsed.data.dueDate}T00:00:00.000Z`)
        : null;
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
    if (
      title !== undefined ||
      assignedTo !== undefined ||
      taskPoints !== undefined ||
      targetValue !== undefined ||
      description !== undefined ||
      dueDate !== undefined
    ) {
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
    if (isProjectLead && !isFinanceRole(role)) {
      // The project lead can be any role (2026-08-07) — the assignee must be
      // in the WorkUnit's own department at the lead's tier or below (matches
      // assignable-members' scope), or be the lead themselves.
      const assignableRoles = rolesAtOrBelow(role);
      const inScope =
        assignee.departmentId === workItem.subUnit.workUnit.departmentId &&
        assignableRoles.includes(assignee.role);
      const isSelf = assignee.id === session.employeeId;
      if (!inScope && !isSelf) {
        return failFor(
          ErrorCode.VALIDATION,
          "Project leads can only assign WorkItems to their own department, at their level or below.",
        );
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
        description,
        dueDate,
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
          data: { title, description, dueDate, assignedTo, taskPoints, status, completedAt: new Date() },
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
      description,
      dueDate,
      assignedTo,
      taskPoints,
      status,
      completedAt: status && !nowCompleted ? null : undefined,
    },
  });

  return ok(updated);
}

// DELETE /api/v1/work-items/:id — soft delete, management only (not the
// assignee). Leaf level — no cascade. The points ledger keeps its row
// untouched for audit even after the WorkItem itself is soft-deleted.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const workItem = await prisma.workItem.findUnique({
    where: { id: params.id },
    include: { subUnit: { include: { workUnit: true } } },
  });
  if (!workItem || workItem.deletedAt) return failFor(ErrorCode.NOT_FOUND);

  const role = session.role;
  const isProjectLead = session.employeeId === workItem.subUnit.workUnit.projectLeadId;
  if (!isFinanceRole(role) && !isProjectLead) {
    return failFor(ErrorCode.FORBIDDEN);
  }

  await prisma.workItem.update({ where: { id: params.id }, data: { deletedAt: new Date() } });
  return ok({ id: params.id, deleted: true });
}
