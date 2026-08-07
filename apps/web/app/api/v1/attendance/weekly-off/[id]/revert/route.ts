import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { requireRole, FINANCE_ROLES, AuthzError } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { audit, clientIp } from "@/lib/audit";
import { pushNotification } from "@/lib/notifications/push";

// Track A (owner request, 2026-08-08). POST /api/v1/attendance/weekly-off/:id/revert
// Admin/HR only. Marks the WeeklyOffMove as inactive, restoring the team's
// default weekly-off day for that week. Used when:
//   1. An employee claimed a day but ended up coming in — revert first so
//      the clock-in is classified as a normal present day rather than
//      compensation (the clock-in already happened or is happening today).
//   2. Admin wants to override/deny a weekly-off claim for operational reasons.
// The employee is notified on revert so they know their off day was cancelled.

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  try {
    requireRole(session, FINANCE_ROLES);
  } catch (err) {
    if (err instanceof AuthzError) return failFor(err.kind);
    throw err;
  }

  const move = await prisma.weeklyOffMove.findUnique({
    where: { id: params.id },
    include: {
      employee: {
        select: {
          id: true,
          fullName: true,
          user: { select: { id: true } },
        },
      },
    },
  });

  if (!move) {
    return failFor(ErrorCode.NOT_FOUND, "Weekly off move not found.");
  }
  if (!move.active) {
    return fail(ErrorCode.CONFLICT, "This weekly off move has already been reverted.", 409);
  }

  if (!session) {
    return failFor(ErrorCode.UNAUTHENTICATED);
  }
  const actor = session;

  const updated = await prisma.weeklyOffMove.update({
    where: { id: params.id },
    data: {
      active: false,
      revertedById: actor.userId,
      revertedAt: new Date(),
    },
  });

  await audit({
    action: "attendance.weekly_off_revert",
    actorUserId: actor.userId,
    actorRole: actor.role,
    entityType: "weekly_off_move",
    entityId: move.id,
    metadata: {
      employee_id: move.employeeId,
      date: move.date.toISOString().slice(0, 10),
      week_start: move.weekStart.toISOString().slice(0, 10),
    },
    ip: clientIp(req),
  });

  // Notify the employee that their weekly-off claim was cancelled.
  if (move.employee.user) {
    const dateStr = move.date.toISOString().slice(0, 10);
    await pushNotification(
      move.employee.user.id,
      "weekly_off_reverted",
      `Your weekly off claim for ${dateStr} has been cancelled by Admin/HR. Your team's default day off applies for this week.`,
      "Weekly Off Cancelled",
    ).catch(() => {});
  }

  return ok(updated);
}
