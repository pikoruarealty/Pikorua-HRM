import { prisma } from "@/lib/db/prisma";
import { TaskReminderContentMode, TaskReminderScope } from "@prisma/client";

// Get-or-create for the singleton TaskReminderConfig row (2026-09-24). Not
// versioned — see the schema comment on the model for why a plain
// "read the one row, or these defaults" resolver is the right shape here,
// unlike payroll/scoring's effective-dated configs.

export type TaskReminderConfigResolved = {
  enabled: boolean;
  intervalMinutes: number;
  contentMode: TaskReminderContentMode;
  scope: TaskReminderScope;
};

export const FALLBACK_TASK_REMINDER_CONFIG: TaskReminderConfigResolved = {
  enabled: true,
  intervalMinutes: 120,
  contentMode: TaskReminderContentMode.count,
  scope: TaskReminderScope.all_pending,
};

export async function getTaskReminderConfig(): Promise<TaskReminderConfigResolved> {
  const row = await prisma.taskReminderConfig.findFirst();
  if (!row) return { ...FALLBACK_TASK_REMINDER_CONFIG };
  return {
    enabled: row.enabled,
    intervalMinutes: row.intervalMinutes,
    contentMode: row.contentMode,
    scope: row.scope,
  };
}

export async function saveTaskReminderConfig(
  data: TaskReminderConfigResolved,
): Promise<TaskReminderConfigResolved> {
  const existing = await prisma.taskReminderConfig.findFirst({ select: { id: true } });
  const row = existing
    ? await prisma.taskReminderConfig.update({ where: { id: existing.id }, data })
    : await prisma.taskReminderConfig.create({ data });
  return {
    enabled: row.enabled,
    intervalMinutes: row.intervalMinutes,
    contentMode: row.contentMode,
    scope: row.scope,
  };
}
