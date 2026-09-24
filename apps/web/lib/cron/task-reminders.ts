import { prisma } from "@/lib/db/prisma";
import { isReminderDue, sendTaskReminders } from "@/lib/notifications/task-reminders-send";
import { isClockedInNow } from "@/lib/attendance/status";
import { getTaskReminderConfig } from "@/lib/notifications/task-reminders-config";
import { TaskReminderScope, WorkItemStatus } from "@prisma/client";

// Pending-task reminder nudge (2026-09-24, owner request). Core logic shared
// by the in-process scheduler tick and the CRON_SECRET HTTP route, same
// split as every other job in lib/cron/.
//
// The admin-configured interval isn't a cron expression — it's a number of
// minutes evaluated per employee against TaskReminderState.lastSentAt. This
// function is meant to run on a short, fixed tick (the scheduler registers it
// every 15 minutes); each run only actually notifies the employees whose
// window has elapsed, so changing the interval in the admin panel takes
// effect within one tick, no redeploy or cron-string surgery required.
//
// "Pending" for this purpose is `pending` + `wip` — a task sitting in
// `in_review` is out of the assignee's hands and isn't something reminding
// them helps with.


function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function runTaskReminders(now: Date = new Date()): Promise<{
  enabled: boolean;
  employeesChecked: number;
  remindersSent: number;
  skippedNotClockedIn: number;
}> {
  const config = await getTaskReminderConfig();
  if (!config.enabled) return { enabled: false, employeesChecked: 0, remindersSent: 0, skippedNotClockedIn: 0 };

  const dueDateFilter =
    config.scope === TaskReminderScope.due_today
      ? { dueDate: { gte: startOfUtcDay(now), lt: new Date(startOfUtcDay(now).getTime() + 86_400_000) } }
      : {};

  const items = await prisma.workItem.findMany({
    where: {
      status: { in: [WorkItemStatus.pending, WorkItemStatus.wip] },
      deletedAt: null,
      ...dueDateFilter,
    },
    select: { id: true, title: true, dueDate: true, assignedTo: true },
    orderBy: { dueDate: "asc" },
  });

  const byEmployee = new Map<string, typeof items>();
  for (const item of items) {
    if (!item.assignedTo) continue;
    const list = byEmployee.get(item.assignedTo);
    if (list) list.push(item);
    else byEmployee.set(item.assignedTo, [item]);
  }

  let employeesChecked = 0;
  let remindersSent = 0;
  let skippedNotClockedIn = 0;

  for (const [employeeId, tasks] of byEmployee) {
    employeesChecked++;

    const state = await prisma.taskReminderState.findUnique({ where: { employeeId } });
    if (!isReminderDue(state?.lastSentAt, now, config.intervalMinutes)) continue;

    // Only nudge people who are at work right now (2026-09-24, owner request).
    // Deliberately `continue` BEFORE the lastSentAt upsert below: a skipped
    // employee stays "due", so their reminder lands on the first tick after
    // they clock in instead of waiting out a whole extra interval.
    if (!(await isClockedInNow(employeeId))) {
      skippedNotClockedIn++;
      continue;
    }

    const user = await prisma.user.findUnique({ where: { employeeId } });
    if (!user) continue; // no login, nothing to notify

    await sendTaskReminders(user.id, tasks, config.contentMode, {
      count: "task_reminder_count",
      list: "task_reminder_list",
      item: "task_reminder_item",
    });

    await prisma.taskReminderState.upsert({
      where: { employeeId },
      create: { employeeId, lastSentAt: now },
      update: { lastSentAt: now },
    });
    remindersSent++;
  }

  return { enabled: true, employeesChecked, remindersSent, skippedNotClockedIn };
}
