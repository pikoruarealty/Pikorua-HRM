import { prisma } from "@/lib/db/prisma";
import { pushNotification } from "@/lib/notifications/push";
import { EmployeeStatus, EventType } from "@prisma/client";

// Track B — Milestone 3.5 core logic, extracted so the HTTP cron route and the
// in-process scheduler share one implementation. Company-wide birthday /
// work-anniversary / custom-event shoutout notifications for today's matches.
// Custom events (2026-08-08) recur annually by month/day, same as birthdays/
// anniversaries — the year on `scheduledAt` is only ever the year it was
// first logged.
//
// Idempotency (2026-08-08): this job previously relied entirely on the daily
// 00:05 UTC cron slot firing exactly once — if the server process wasn't up
// at that moment (a dev restart, a redeploy), that day's shoutout was
// silently missed with no catch-up, which is what happened to the reported
// "saw it on the calendar but never got the notification" anniversary. Fixed
// by checking, per user/message, whether today already has a matching
// notification before sending another — so it's now safe to call this more
// than once on the same day (the message text is identical run-to-run but
// differs year-to-year, e.g. it doesn't repeat "N years" wording across
// years, so a same-day createdAt window is what actually distinguishes a
// resend from next year's genuinely-new shoutout, not the message alone).
// This lets the scheduler also run it once immediately at boot as a
// catch-up, not just wait for the next 00:05 slot.
export async function runBirthdayCheck(now: Date = new Date()): Promise<{
  birthdays: number;
  anniversaries: number;
  customEvents: number;
  notificationsSent: number;
}> {
  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();

  const employees = await prisma.employee.findMany({
    where: { status: EmployeeStatus.active },
    select: { id: true, fullName: true, dateOfBirth: true, dateOfJoining: true },
  });

  const birthdays = employees.filter(
    (e) => e.dateOfBirth && e.dateOfBirth.getUTCMonth() + 1 === month && e.dateOfBirth.getUTCDate() === day,
  );
  const anniversaries = employees.filter(
    (e) => e.dateOfJoining.getUTCMonth() + 1 === month && e.dateOfJoining.getUTCDate() === day,
  );

  const allCustomEvents = await prisma.event.findMany({
    where: { type: EventType.custom, scheduledAt: { not: null } },
    include: { employee: { select: { id: true, fullName: true } } },
  });
  const customEvents = allCustomEvents.filter(
    (e) => e.scheduledAt!.getUTCMonth() + 1 === month && e.scheduledAt!.getUTCDate() === day,
  );

  if (birthdays.length === 0 && anniversaries.length === 0 && customEvents.length === 0) {
    return { birthdays: 0, anniversaries: 0, customEvents: 0, notificationsSent: 0 };
  }

  const users = await prisma.user.findMany({ select: { id: true } });
  // Bound the dedup lookup to "today" (UTC) — the message text repeats
  // verbatim year over year (no year number in it), so without this bound a
  // same-text match would wrongly suppress every future year's notification
  // after the first.
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  async function notifyOnce(userId: string, type: string, message: string, title?: string): Promise<boolean> {
    const alreadySent = await prisma.notification.findFirst({
      where: { userId, type, message, createdAt: { gte: todayStart } },
    });
    if (alreadySent) return false;
    await pushNotification(userId, type, message, title);
    return true;
  }

  let notificationsSent = 0;
  for (const e of birthdays) {
    const message = `Today is ${e.fullName}'s birthday! 🎉`;
    for (const u of users) {
      if (await notifyOnce(u.id, "birthday", message)) notificationsSent++;
    }
  }
  for (const e of anniversaries) {
    const message = `Today is ${e.fullName}'s work anniversary!`;
    for (const u of users) {
      if (await notifyOnce(u.id, "anniversary", message)) notificationsSent++;
    }
  }
  for (const e of customEvents) {
    // Pass the event's own title as the notification's title instead of
    // letting it fall back to a humanized `type` tag ("Custom Event",
    // unhelpful) — the message body still carries who it's for.
    const title = e.title ?? "Event";
    const message = e.employee ? `📌 Today: ${e.employee.fullName} — ${title}` : `📌 Today: ${title}`;
    for (const u of users) {
      if (await notifyOnce(u.id, "custom_event", message, title)) notificationsSent++;
    }
  }

  return {
    birthdays: birthdays.length,
    anniversaries: anniversaries.length,
    customEvents: customEvents.length,
    notificationsSent,
  };
}
