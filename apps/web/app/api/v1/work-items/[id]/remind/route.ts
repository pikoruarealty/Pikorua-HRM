import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { isUuid } from "@/lib/api/params";
import { WorkItemStatus } from "@prisma/client";
import { pushNotification } from "@/lib/notifications/push";
import { MANUAL_REMINDER_TYPE, recentlyReminded } from "@/lib/notifications/manual-reminder";
import { audit, clientIp } from "@/lib/audit";

// POST /api/v1/work-items/:id/remind — Admin/HR nudge for ONE task (2026-09-24,
// owner request). Sends the assignee an immediate notification (in-app + push)
// naming the task. Only open work (pending/wip) can be reminded about — a task
// already in review or completed is not waiting on the assignee.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!isFinanceRole(session.role)) return failFor(ErrorCode.FORBIDDEN);
  if (!isUuid(params.id)) return failFor(ErrorCode.NOT_FOUND);

  const workItem = await prisma.workItem.findUnique({
    where: { id: params.id },
    select: { id: true, title: true, status: true, dueDate: true, assignedTo: true, deletedAt: true },
  });
  if (!workItem || workItem.deletedAt) return failFor(ErrorCode.NOT_FOUND);
  if (workItem.status !== WorkItemStatus.pending && workItem.status !== WorkItemStatus.wip) {
    return failFor(ErrorCode.CONFLICT, "Only open tasks can be reminded about.");
  }

  const user = await prisma.user.findUnique({ where: { employeeId: workItem.assignedTo } });
  if (!user) return failFor(ErrorCode.VALIDATION, "The assignee has no login to notify.");
  if (await recentlyReminded(user.id)) {
    return fail(ErrorCode.CONFLICT, "They were just reminded — give it a moment.", 409);
  }

  const due = workItem.dueDate ? ` (due ${workItem.dueDate.toISOString().slice(0, 10)})` : "";
  await pushNotification(
    user.id,
    MANUAL_REMINDER_TYPE,
    `Reminder: "${workItem.title}" is still pending${due}.`,
    "Task reminder",
  );
  await audit({
    action: "task_reminder.manual",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "work_item",
    entityId: workItem.id,
    metadata: { assigneeId: workItem.assignedTo },
    ip: clientIp(req),
  });

  return ok({ sent: 1 });
}
