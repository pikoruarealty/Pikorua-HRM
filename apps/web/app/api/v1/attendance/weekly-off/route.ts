import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { todayDateOnly } from "@/lib/attendance/time";
import { isOffDay, weekStartOf } from "@/lib/attendance/week";
import { audit, clientIp } from "@/lib/audit";
import { notifyFinanceUsers } from "@/lib/notifications/push";

// Track A (owner request, 2026-08-08). Self-service weekly-off claim: any
// employee not yet clocked in today, who hasn't already used this week's
// off day, can claim TODAY as their off day for the week (one per week,
// resets Monday). GET reports today's status (used to show/hide the
// dashboard button); POST performs the claim.

async function getStatus(employeeId: string) {
  const today = todayDateOnly();
  const weekStart = weekStartOf(today);
  const weekStartNext = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [employee, todayRecord, move] = await Promise.all([
    prisma.employee.findUnique({
      where: { id: employeeId },
      select: { team: { select: { defaultWeeklyOffDay: true } } },
    }),
    prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId, date: today } },
      select: { clockInRaw: true },
    }),
    prisma.weeklyOffMove.findUnique({
      where: { employeeId_weekStart: { employeeId, weekStart } },
    }),
  ]);

  const defaultOffDay = employee?.team?.defaultWeeklyOffDay ?? 0;
  const movedOffDateByWeek = move?.active
    ? new Map([[weekStart.toISOString().slice(0, 10), move.date.toISOString().slice(0, 10)]])
    : new Map<string, string>();

  const clockedInToday = !!todayRecord?.clockInRaw;
  const offToday = isOffDay(today, defaultOffDay, movedOffDateByWeek);
  const usedThisWeek = !!move?.active;
  const canClaimToday = !clockedInToday && !offToday && !usedThisWeek;

  return {
    date: today.toISOString().slice(0, 10),
    weekStart: weekStart.toISOString().slice(0, 10),
    clockedInToday,
    offToday,
    usedThisWeek,
    move: move?.active ? { id: move.id, date: move.date.toISOString().slice(0, 10) } : null,
    canClaimToday,
    weekStartNext: weekStartNext.toISOString().slice(0, 10),
  };
}

export async function GET() {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!session.employeeId) return failFor(ErrorCode.FORBIDDEN, "No employee record linked to this account.");

  return ok(await getStatus(session.employeeId));
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!session.employeeId) return failFor(ErrorCode.FORBIDDEN, "No employee record linked to this account.");

  const status = await getStatus(session.employeeId);
  if (status.clockedInToday) {
    return fail(ErrorCode.VALIDATION, "You're already clocked in today — can't take today off.", 422);
  }
  if (status.offToday) {
    return fail(ErrorCode.VALIDATION, "Today is already your day off.", 422);
  }
  if (status.usedThisWeek) {
    return fail(ErrorCode.VALIDATION, "You've already taken your weekly off for this week.", 422);
  }

  const today = todayDateOnly();
  const weekStart = weekStartOf(today);

  const move = await prisma.weeklyOffMove.upsert({
    where: { employeeId_weekStart: { employeeId: session.employeeId, weekStart } },
    create: { employeeId: session.employeeId, weekStart, date: today, active: true },
    update: { date: today, active: true, revertedById: null, revertedAt: null },
  });

  await audit({
    action: "attendance.weekly_off_claim",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "weekly_off_move",
    entityId: move.id,
    metadata: { employee_id: session.employeeId, date: move.date.toISOString().slice(0, 10) },
    ip: clientIp(req),
  });

  // Notify Admin/HR so they can see who has taken a weekly off (mirrors the
  // leave-request notification pattern — weekly off affects attendance counts
  // the same way). Fire-and-safe; never blocks the response.
  const dateStr = move.date.toISOString().slice(0, 10);
  const employee = await prisma.employee.findUnique({
    where: { id: session.employeeId },
    select: { fullName: true },
  });
  await notifyFinanceUsers(
    "weekly_off_claimed",
    `${employee?.fullName ?? "An employee"} has taken their weekly off for ${dateStr} (move ID: ${move.id}).`,
    "Weekly Off Claimed",
    session.userId,
  ).catch(() => {});

  return ok(await getStatus(session.employeeId), 201);
}
