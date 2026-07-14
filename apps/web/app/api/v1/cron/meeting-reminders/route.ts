import { prisma } from "@/lib/db/prisma";
import { pushNotification } from "@/lib/notifications/push";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { EventType } from "@prisma/client";

// Track B. POST /api/v1/cron/meeting-reminders — Milestone 3.5.
// Sends a reminder notification at `scheduled_at - reminder_lead_minutes`
// for each meeting whose reminder window has opened but who hasn't fired
// yet. CRON_SECRET-gated, not a user session.
//
// Events has no persisted "reminder sent" flag (adding one would touch the
// shared schema for a single cron's bookkeeping) — idempotency is instead
// derived from `notifications`: each reminder is tagged
// `meeting_reminder:<eventId>` and skipped per-user if that tag already
// exists for them, so re-running the cron inside the same window is a no-op.

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return failFor(ErrorCode.UNAUTHENTICATED, "Invalid or missing cron secret.");
  }

  const now = new Date();

  const meetings = await prisma.event.findMany({
    where: {
      type: EventType.meeting,
      scheduledAt: { not: null, gt: now },
      reminderLeadMinutes: { not: null },
    },
    include: {
      invitees: {
        include: {
          employee: { include: { user: true } },
          team: { include: { members: { include: { user: true } } } },
        },
      },
    },
  });

  let remindersSent = 0;
  let meetingsInWindow = 0;

  for (const meeting of meetings) {
    const reminderAt = new Date(meeting.scheduledAt!.getTime() - meeting.reminderLeadMinutes! * 60_000);
    if (now < reminderAt) continue; // window not open yet
    meetingsInWindow++;

    const notifiedType = `meeting_reminder:${meeting.id}`;

    const userIds = new Set<string>();
    for (const invitee of meeting.invitees) {
      if (invitee.employee?.user) userIds.add(invitee.employee.user.id);
      if (invitee.team) {
        for (const member of invitee.team.members) {
          if (member.user) userIds.add(member.user.id);
        }
      }
    }

    for (const userId of userIds) {
      const alreadySent = await prisma.notification.findFirst({
        where: { userId, type: notifiedType },
      });
      if (alreadySent) continue;

      await pushNotification(
        userId,
        notifiedType,
        `Reminder: "${meeting.title}" starts at ${meeting.scheduledAt!.toISOString()}.`,
      );
      remindersSent++;
    }
  }

  return ok({ meetingsInWindow, remindersSent });
}
