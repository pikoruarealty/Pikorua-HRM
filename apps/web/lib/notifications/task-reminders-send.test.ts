import { describe, expect, test } from "bun:test";
import { TaskReminderContentMode } from "@prisma/client";
import {
  MIN_REMINDER_INTERVAL_MINUTES,
  buildTaskReminderMessages,
  isReminderDue,
  type ReminderTask,
} from "./task-reminders-send";

const task = (title: string, due: string | null = null): ReminderTask => ({
  id: title,
  title,
  dueDate: due ? new Date(`${due}T00:00:00.000Z`) : null,
});

describe("buildTaskReminderMessages", () => {
  test("sends nothing when there are no open tasks, in every mode", () => {
    for (const mode of Object.values(TaskReminderContentMode)) {
      expect(buildTaskReminderMessages([], mode)).toEqual([]);
    }
  });

  test("count mode: one notification, singular vs plural", () => {
    expect(buildTaskReminderMessages([task("a")], TaskReminderContentMode.count)).toEqual([
      { title: "Pending tasks", message: "You have 1 pending task." },
    ]);
    expect(
      buildTaskReminderMessages([task("a"), task("b"), task("c")], TaskReminderContentMode.count)[0].message,
    ).toBe("You have 3 pending tasks.");
  });

  test("full_list mode: one notification naming the tasks", () => {
    expect(
      buildTaskReminderMessages([task("Fix login"), task("Write docs")], TaskReminderContentMode.full_list),
    ).toEqual([{ title: "Pending tasks", message: "Pending: Fix login, Write docs" }]);
  });

  test("full_list mode: caps at 10 titles and says how many were left out", () => {
    const many = Array.from({ length: 13 }, (_, i) => task(`t${i + 1}`));
    const [msg] = buildTaskReminderMessages(many, TaskReminderContentMode.full_list);
    expect(msg.message).toContain("t10");
    expect(msg.message).not.toContain("t11,");
    expect(msg.message.endsWith("(+3 more)")).toBe(true);
  });

  test("per_task mode: one notification per task, with the due date when there is one", () => {
    const msgs = buildTaskReminderMessages(
      [task("Ship it", "2026-09-30"), task("No deadline")],
      TaskReminderContentMode.per_task,
    );
    expect(msgs).toEqual([
      { title: "Pending task", message: '"Ship it" is still pending (due 2026-09-30).' },
      { title: "Pending task", message: '"No deadline" is still pending.' },
    ]);
  });
});

describe("isReminderDue", () => {
  const now = new Date("2026-09-24T12:00:00.000Z");
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

  test("is due when the employee has never been reminded", () => {
    expect(isReminderDue(null, now, 120)).toBe(true);
    expect(isReminderDue(undefined, now, 120)).toBe(true);
  });

  test("is not due until the full interval has elapsed", () => {
    expect(isReminderDue(minutesAgo(119), now, 120)).toBe(false);
    expect(isReminderDue(minutesAgo(120), now, 120)).toBe(true);
    expect(isReminderDue(minutesAgo(500), now, 120)).toBe(true);
  });

  test("a tiny or zero interval can't cause reminder spam — it is floored", () => {
    expect(isReminderDue(minutesAgo(1), now, 0)).toBe(false);
    expect(isReminderDue(minutesAgo(MIN_REMINDER_INTERVAL_MINUTES - 1), now, 1)).toBe(false);
    expect(isReminderDue(minutesAgo(MIN_REMINDER_INTERVAL_MINUTES), now, 1)).toBe(true);
  });
});
