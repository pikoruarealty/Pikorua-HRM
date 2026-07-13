import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { WorkItemStatus } from "@prisma/client";

// Track B. PATCH /api/v1/work-items/:id — Milestone 1.2 (atomic mode only).

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  assignedTo: z.string().uuid().optional(),
  taskPoints: z.number().int().positive().optional(),
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
  const { title, assignedTo, taskPoints, status } = parsed.data;

  if (!canEditAll) {
    // Assigned Employee: status only.
    if (title !== undefined || assignedTo !== undefined || taskPoints !== undefined) {
      return failFor(ErrorCode.FORBIDDEN, "You can only update this task's status.");
    }
  }

  if (assignedTo) {
    const assignee = await prisma.employee.findUnique({ where: { id: assignedTo } });
    if (!assignee) {
      return failFor(ErrorCode.VALIDATION, "assignedTo does not reference an existing employee.");
    }
  }

  const wasCompleted = workItem.status === WorkItemStatus.completed;
  const nowCompleted = status === WorkItemStatus.completed;

  const updated = await prisma.workItem.update({
    where: { id: params.id },
    data: {
      title,
      assignedTo,
      taskPoints,
      status,
      completedAt: nowCompleted && !wasCompleted ? new Date() : status && !nowCompleted ? null : undefined,
    },
  });

  return ok(updated);
}
