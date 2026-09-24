import { pushNotification } from "@/lib/notifications/push";
import { TaskReminderContentMode } from "@prisma/client";

// One place that turns "these open tasks for this user" into notifications, so
// the scheduled nudge (lib/cron/task-reminders.ts) and the Admin's on-demand
// Remind buttons (2026-09-24) read identically and can't drift apart.

export type ReminderTask = { id: string; title: string; dueDate: Date | null };

function dueSuffix(dueDate: Date | null): string {
  return dueDate ? ` (due ${dueDate.toISOString().slice(0, 10)})` : "";
}

/** Returns how many notifications were created. */
export async function sendTaskReminders(
  userId: string,
  tasks: ReminderTask[],
  mode: TaskReminderContentMode,
  type: { count: string; list: string; item: string },
): Promise<number> {
  if (tasks.length === 0) return 0;

  switch (mode) {
    case TaskReminderContentMode.per_task:
      for (const task of tasks) {
        await pushNotification(userId, type.item, `"${task.title}" is still pending${dueSuffix(task.dueDate)}.`, "Pending task");
      }
      return tasks.length;
    case TaskReminderContentMode.full_list: {
      const shown = tasks.slice(0, 10).map((t) => t.title);
      const extra = tasks.length > shown.length ? ` (+${tasks.length - shown.length} more)` : "";
      await pushNotification(userId, type.list, `Pending: ${shown.join(", ")}${extra}`, "Pending tasks");
      return 1;
    }
    case TaskReminderContentMode.count:
    default:
      await pushNotification(
        userId,
        type.count,
        `You have ${tasks.length} pending task${tasks.length === 1 ? "" : "s"}.`,
        "Pending tasks",
      );
      return 1;
  }
}
