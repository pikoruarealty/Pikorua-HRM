import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { todayDateOnly, computeHours } from "@/lib/attendance/time";
import { buildEodSummary } from "@/lib/eod/summary";
import { pushNotification } from "@/lib/notifications/push";

// Track A. POST /api/v1/attendance/clock-out — server-timestamped. Computes
// a preliminary total_hours/is_half_day from the raw times immediately (best
// available figures for the review UI); these get recomputed from the
// *approved* times on edit/approve, since payroll only ever counts approved
// records (see PATCH .../edit and .../approve).
//
// PRD §5.4: clock-out is EOD. We derive an EOD summary from the day's task
// selections + points credited today (buildEodSummary — read-only; points are
// already credited on completion), return it, and push a notification so the
// employee gets a wrap-up of the day. No points are (re-)credited here.
export async function POST() {
  const session = await getSession();
  if (!session) {
    return failFor(ErrorCode.UNAUTHENTICATED);
  }
  if (!session.employeeId) {
    return failFor(ErrorCode.FORBIDDEN, "No employee record linked to this account.");
  }
  const employeeId = session.employeeId;

  const date = todayDateOnly();
  const now = new Date();

  const existing = await prisma.attendanceRecord.findUnique({
    where: { employeeId_date: { employeeId, date } },
  });

  if (!existing?.clockInRaw) {
    return fail(ErrorCode.CONFLICT, "Must clock in before clocking out.", 409);
  }
  if (existing.clockOutRaw) {
    return fail(ErrorCode.CONFLICT, "Already clocked out today.", 409);
  }

  const { totalHours, isHalfDay } = computeHours(existing.clockInRaw, now);

  const record = await prisma.attendanceRecord.update({
    where: { id: existing.id },
    data: { clockOutRaw: now, totalHours, isHalfDay },
  });

  // EOD wrap-up. Best-effort notification — never fail the clock-out itself if
  // the summary/notification has trouble.
  const eod = await buildEodSummary(employeeId, date);
  if (session.userId) {
    await pushNotification(
      session.userId,
      "eod_summary",
      `EOD: completed ${eod.completedCount}/${eod.plannedCount} planned task(s)` +
        (eod.pointsEarnedToday > 0 ? `, +${eod.pointsEarnedToday} pts today.` : "."),
    ).catch(() => {});
  }

  return ok({ record, eod });
}
