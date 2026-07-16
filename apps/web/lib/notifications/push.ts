import { prisma } from "@/lib/db/prisma";
import type { Notification } from "@prisma/client";
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
