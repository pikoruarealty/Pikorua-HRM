import { prisma } from "@/lib/db/prisma";
import { pushNotification } from "@/lib/notifications/push";
import { EventType } from "@prisma/client";

// Track B — Milestone 3.5 core logic, extracted so the HTTP cron route and the
// in-process scheduler share one implementation. Idempotency is derived from
// `notifications` (tag `meeting_reminder:<eventId>` per user), so re-running
// inside the same open window is a no-op — no persisted "reminder sent" flag.
export async function runMeetingReminders(now: Date = new Date()): Promise<{
  meetingsInWindow: number;
  remindersSent: number;
}> {
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

  return { meetingsInWindow, remindersSent };
}
