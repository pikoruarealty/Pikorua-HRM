import { prisma } from "@/lib/db/prisma";
import { pushNotification } from "@/lib/notifications/push";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { EmployeeStatus } from "@prisma/client";

// Track B. POST /api/v1/cron/birthday-check — Milestone 3.5.
// Nightly cron: checks `date_of_birth`/`date_of_joining` against today,
// pushes a notification to every user for each match (company-wide
// birthday/anniversary shoutout), via 3.2's pushNotification service.
// CRON_SECRET-gated, not a user session (same pattern as 3.1's
// recognition-snapshot cron).

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return failFor(ErrorCode.UNAUTHENTICATED, "Invalid or missing cron secret.");
  }

  const now = new Date();
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
    return ok({ birthdays: 0, anniversaries: 0, notificationsSent: 0 });
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

  return ok({ birthdays: birthdays.length, anniversaries: anniversaries.length, notificationsSent });
}
