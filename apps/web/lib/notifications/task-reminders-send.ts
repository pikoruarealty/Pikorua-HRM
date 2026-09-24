import { pushNotification } from "@/lib/notifications/push";
import { TaskReminderContentMode } from "@prisma/client";

// One place that turns "these open tasks for this user" into notifications, so
// the scheduled nudge (lib/cron/task-reminders.ts) and the Admin's on-demand
// Remind buttons (2026-09-24) read identically and can't drift apart. The
// wording and the due-ness rule are pure functions so they are unit-tested
// without a database; sendTaskReminders is just the thin delivery loop.

export type ReminderTask = { id: string; title: string; dueDate: Date | null };
export type ReminderMessage = { title: string; message: string };

/** Never remind more often than this, whatever an Admin types into the form. */
export const MIN_REMINDER_INTERVAL_MINUTES = 5;
const MAX_TITLES_IN_LIST = 10;

/** Has an employee's reminder interval elapsed since their last one? */
export function isReminderDue(
  lastSentAt: Date | null | undefined,
  now: Date,
  intervalMinutes: number,
): boolean {
  if (!lastSentAt) return true;
  const interval = Math.max(intervalMinutes, MIN_REMINDER_INTERVAL_MINUTES);
  return now.getTime() - lastSentAt.getTime() >= interval * 60_000;
}

function dueSuffix(dueDate: Date | null): string {
  return dueDate ? ` (due ${dueDate.toISOString().slice(0, 10)})` : "";
}

export function buildTaskReminderMessages(
  tasks: ReminderTask[],
  mode: TaskReminderContentMode,
): ReminderMessage[] {
  if (tasks.length === 0) return [];

  switch (mode) {
    case TaskReminderContentMode.per_task:
      return tasks.map((t) => ({
        title: "Pending task",
        message: `"${t.title}" is still pending${dueSuffix(t.dueDate)}.`,
      }));
    case TaskReminderContentMode.full_list: {
      const shown = tasks.slice(0, MAX_TITLES_IN_LIST).map((t) => t.title);
      const extra = tasks.length > shown.length ? ` (+${tasks.length - shown.length} more)` : "";
      return [{ title: "Pending tasks", message: `Pending: ${shown.join(", ")}${extra}` }];
    }
    case TaskReminderContentMode.count:
    default:
      return [
        {
          title: "Pending tasks",
          message: `You have ${tasks.length} pending task${tasks.length === 1 ? "" : "s"}.`,
        },
      ];
  }
}

/** The notification `type` for each mode, so callers keep their own tagging. */
export type ReminderTypes = { count: string; list: string; item: string };

function typeFor(mode: TaskReminderContentMode, types: ReminderTypes): string {
  if (mode === TaskReminderContentMode.per_task) return types.item;
  if (mode === TaskReminderContentMode.full_list) return types.list;
  return types.count;
}

/** Returns how many notifications were created. */
export async function sendTaskReminders(
  userId: string,
  tasks: ReminderTask[],
  mode: TaskReminderContentMode,
  types: ReminderTypes,
): Promise<number> {
  const messages = buildTaskReminderMessages(tasks, mode);
  for (const m of messages) {
    await pushNotification(userId, typeFor(mode, types), m.message, m.title);
  }
  return messages.length;
}
