import { prisma } from "@/lib/db/prisma";
import { EmployeeStatus, Role, type Notification } from "@prisma/client";
import { sendPushToUser } from "@/lib/notifications/fcm";

// Track B, Milestone 3.2. Generic notification push service — any module
// (including future Track A code, e.g. "leave approved"/"payslip generated")
// can call this instead of writing to `notifications` directly. Not on the
// shared-file list (didn't exist in Phase 0), but genuinely reusable — flag
// Umang so Track A can call it rather than building its own.
//
// `type` is a free-text tag (e.g. "leave_approved", "task_assigned",
// "birthday") — see SCHEMA.md `notifications`, not a Prisma enum.
//
// FCM web push (added 2026-07-15): every call also fans out to the user's
// registered browsers, so every existing and future notification type gets
// push for free — this is the single chokepoint, same pattern as
// audit()/createLogger() elsewhere in this codebase. The FCM send never
// blocks or fails the in-app notification write (fire-and-safe — see
// lib/notifications/fcm.ts).
function humanizeType(type: string): string {
  return type
    .split("_")
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Create an in-app notification and fan it out to the user's browsers via FCM.
 *
 * `title` is optional: most notification types are a single self-contained
 * sentence and fall back to a humanized `type` ("Leave Approved"). Pass it when
 * the notification has a real headline distinct from its body — announcements
 * do, so their long body renders as its own block instead of being crammed onto
 * one line with the title.
 */
export async function pushNotification(
  userId: string,
  type: string,
  message: string,
  title?: string,
): Promise<Notification> {
  const notification = await prisma.notification.create({
    data: { userId, type, message, title: title ?? null },
  });
  sendPushToUser(userId, { title: title ?? humanizeType(type), body: message, type }).catch((err) =>
    console.error(`[fcm] unexpected error sending push for user=${userId}:`, err),
  );
  return notification;
}

/**
 * Fan a notification out to every active employee's linked user (e.g. a new
 * company holiday, a recognition snapshot). Mirrors the "everyone" resolution
 * already used by the announcements route, extracted here since it's now
 * needed in more than one place. Never throws — a notify failure must never
 * fail the caller's actual mutation (holiday create, cron run, etc).
 */
export async function notifyAllActiveUsers(
  type: string,
  message: string,
  title?: string,
  excludeUserId?: string,
): Promise<void> {
  try {
    const recipients = await prisma.user.findMany({
      where: {
        employee: { status: EmployeeStatus.active },
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      },
      select: { id: true },
    });
    await Promise.allSettled(recipients.map((u) => pushNotification(u.id, type, message, title)));
  } catch (err) {
    console.error(`[notifications] failed to notify all active users (type=${type}):`, err);
  }
}

/**
 * Notify the approver pool (all Admin + HR users) — used when a request is
 * filed so it doesn't sit unseen until someone happens to open /requests.
 * `excludeUserId` skips the submitter (an HR person filing their own request
 * shouldn't be pinged to review it — it goes up to Admin anyway). Never throws;
 * a notify failure must not fail the request creation itself.
 */
export async function notifyFinanceUsers(
  type: string,
  message: string,
  title?: string,
  excludeUserId?: string,
): Promise<void> {
  try {
    const recipients = await prisma.user.findMany({
      where: {
        role: { in: [Role.admin, Role.hr] },
        employee: { status: EmployeeStatus.active },
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      },
      select: { id: true },
    });
    await Promise.allSettled(recipients.map((u) => pushNotification(u.id, type, message, title)));
  } catch (err) {
    console.error(`[notifications] failed to notify finance users (type=${type}):`, err);
  }
}
