import { prisma } from "@/lib/db/prisma";
import type { Notification } from "@prisma/client";

// Track B, Milestone 3.2. Generic notification push service — any module
// (including future Track A code, e.g. "leave approved"/"payslip generated")
// can call this instead of writing to `notifications` directly. Not on the
// shared-file list (didn't exist in Phase 0), but genuinely reusable — flag
// Umang so Track A can call it rather than building its own.
//
// `type` is a free-text tag (e.g. "leave_approved", "task_assigned",
// "birthday") — see SCHEMA.md `notifications`, not a Prisma enum.
export async function pushNotification(
  userId: string,
  type: string,
  message: string,
): Promise<Notification> {
  return prisma.notification.create({
    data: { userId, type, message },
  });
}
