import { prisma } from "@/lib/db/prisma";
import { pushNotification } from "@/lib/notifications/push";
import { EmployeeStatus } from "@prisma/client";

// Track B — Milestone 3.5 core logic, extracted so the HTTP cron route and the
// in-process scheduler share one implementation. Company-wide birthday /
// work-anniversary shoutout notifications for today's matches.
export async function runBirthdayCheck(now: Date = new Date()): Promise<{
  birthdays: number;
  anniversaries: number;
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

  if (birthdays.length === 0 && anniversaries.length === 0) {
    return { birthdays: 0, anniversaries: 0, notificationsSent: 0 };
  }

  const users = await prisma.user.findMany({ select: { id: true } });

  let notificationsSent = 0;
  for (const e of birthdays) {
    for (const u of users) {
      await pushNotification(u.id, "birthday", `Today is ${e.fullName}'s birthday! 🎉`);
      notificationsSent++;
    }
  }
  for (const e of anniversaries) {
    for (const u of users) {
      await pushNotification(u.id, "anniversary", `Today is ${e.fullName}'s work anniversary!`);
      notificationsSent++;
    }
  }

  return { birthdays: birthdays.length, anniversaries: anniversaries.length, notificationsSent };
}
