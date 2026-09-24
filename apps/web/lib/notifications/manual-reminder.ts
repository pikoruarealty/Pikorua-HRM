import { prisma } from "@/lib/db/prisma";

// Shared bits of the Admin/HR on-demand "Remind" buttons (2026-09-24): one
// notification type for every manual nudge, and a short cooldown so a
// double-click (or two admins pressing it together) can't spam an employee.

export const MANUAL_REMINDER_TYPE = "task_reminder_manual";
export const MANUAL_REMINDER_TYPES = {
  count: MANUAL_REMINDER_TYPE,
  list: MANUAL_REMINDER_TYPE,
  item: MANUAL_REMINDER_TYPE,
};
const COOLDOWN_MS = 30_000;

export async function recentlyReminded(userId: string): Promise<boolean> {
  const recent = await prisma.notification.findFirst({
    where: {
      userId,
      type: MANUAL_REMINDER_TYPE,
      createdAt: { gt: new Date(Date.now() - COOLDOWN_MS) },
    },
    select: { id: true },
  });
  return recent !== null;
}
