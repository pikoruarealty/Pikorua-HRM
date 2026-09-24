import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { isUuid } from "@/lib/api/params";
import { WorkItemStatus } from "@prisma/client";
import { getTaskReminderConfig } from "@/lib/notifications/task-reminders-config";
import { sendTaskReminders } from "@/lib/notifications/task-reminders-send";
import { MANUAL_REMINDER_TYPES, recentlyReminded } from "@/lib/notifications/manual-reminder";
import { audit, clientIp } from "@/lib/audit";

// POST /api/v1/employees/:id/remind-tasks — Admin/HR nudge covering ALL of one
// employee's open tasks (2026-09-24, owner request). Uses the same content mode
// the Admin picked for scheduled reminders (count / list / one per task), but
// deliberately ignores the "due today only" scope: someone pressing Remind on
// a person wants that person's whole open list, not a filtered slice.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!isFinanceRole(session.role)) return failFor(ErrorCode.FORBIDDEN);
  if (!isUuid(params.id)) return failFor(ErrorCode.NOT_FOUND);

  const employee = await prisma.employee.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!employee) return failFor(ErrorCode.NOT_FOUND);

  const user = await prisma.user.findUnique({ where: { employeeId: employee.id } });
  if (!user) return failFor(ErrorCode.VALIDATION, "This employee has no login to notify.");

  const tasks = await prisma.workItem.findMany({
    where: {
      assignedTo: employee.id,
      deletedAt: null,
      status: { in: [WorkItemStatus.pending, WorkItemStatus.wip] },
    },
    select: { id: true, title: true, dueDate: true },
    orderBy: { dueDate: "asc" },
  });
  if (tasks.length === 0) return ok({ sent: 0, openTasks: 0 });

  if (await recentlyReminded(user.id)) {
    return fail(ErrorCode.CONFLICT, "They were just reminded — give it a moment.", 409);
  }

  const config = await getTaskReminderConfig();
  const sent = await sendTaskReminders(user.id, tasks, config.contentMode, MANUAL_REMINDER_TYPES);
  await audit({
    action: "task_reminder.manual",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "employee",
    entityId: employee.id,
    metadata: { openTasks: tasks.length, notifications: sent },
    ip: clientIp(req),
  });

  return ok({ sent, openTasks: tasks.length });
}
