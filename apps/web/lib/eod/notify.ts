import { prisma } from "@/lib/db/prisma";
import { pushNotification } from "@/lib/notifications/push";
import { Role } from "@/lib/rbac";
import { type EodSummary } from "@/lib/eod/summary";

// Shared by POST /attendance/clock-out (manual/WFH) and the TeamOffice
// reconciler (biometric) — an end-of-day report reaches the same people
// regardless of how the clock-out happened.
export async function notifyEodToManagement(
  employeeId: string,
  selfUserId: string | undefined,
  eod: EodSummary,
): Promise<void> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { fullName: true, team: { select: { teamLeadId: true } } },
  });
  if (!employee) return;

  const leadEmployeeId = employee.team?.teamLeadId ?? null;

  const recipients = await prisma.user.findMany({
    where: {
      OR: [
        { role: { in: [Role.admin, Role.hr] } },
        ...(leadEmployeeId ? [{ employeeId: leadEmployeeId }] : []),
      ],
      ...(selfUserId ? { id: { not: selfUserId } } : {}),
    },
    select: { id: true },
  });
  if (recipients.length === 0) return;

  const message =
    `${employee.fullName}'s EOD: completed ${eod.completedCount}/${eod.plannedCount} planned task(s)` +
    (eod.inReviewCount > 0 ? `, ${eod.inReviewCount} awaiting review` : "") +
    (!eod.isMetric && eod.pointsEarnedToday > 0 ? `, +${eod.pointsEarnedToday} pts today.` : ".");

  await Promise.allSettled(
    recipients.map((u) => pushNotification(u.id, "eod_report", message, "EOD report")),
  );
}
