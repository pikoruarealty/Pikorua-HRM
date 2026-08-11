import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { todayDateOnly } from "@/lib/attendance/time";
import { findOpenSession, summariseSessions } from "@/lib/attendance/sessions";
import { buildEodSummary, type EodSummary } from "@/lib/eod/summary";
import { pushNotification } from "@/lib/notifications/push";
import { Role } from "@prisma/client";
import { z } from "zod";

// Track A. POST /api/v1/attendance/clock-out — server-timestamped. Computes
// a preliminary total_hours/is_half_day from the day's sessions immediately
// (best available figures for the review UI); these get recomputed from the
// *approved* times on edit/approve, since payroll only ever counts approved
// records (see PATCH .../edit and .../approve).
//
// PRD §5.4: clock-out is EOD. We derive an EOD summary from the day's task
// selections + points credited today (buildEodSummary — read-only; points are
// already credited on completion), return it, and push a notification so the
// employee gets a wrap-up of the day. No points are (re-)credited here.
//
// 2026-08-11: clocking out closes the current session and no longer ends the
// day — the employee can clock in again (and must, before logging any more
// progress). `endOfDay` says which of the two this is. It defaults to true, so
// a bare POST behaves exactly as it always did; sending false is "stepping out
// for a bit", which skips the EOD wrap-up and the report to management rather
// than firing one at every lunch break.
const bodySchema = z.object({ endOfDay: z.boolean().optional() }).strict().optional();

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return failFor(ErrorCode.UNAUTHENTICATED);
  }
  if (!session.employeeId) {
    return failFor(ErrorCode.FORBIDDEN, "No employee record linked to this account.");
  }
  const employeeId = session.employeeId;

  let endOfDay = true;
  const raw = await req.text();
  if (raw.trim().length > 0) {
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(raw);
    } catch {
      return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
    }
    const parsed = bodySchema.safeParse(parsedBody);
    if (!parsed.success) {
      return failFor(ErrorCode.VALIDATION, "endOfDay must be a boolean.");
    }
    endOfDay = parsed.data?.endOfDay ?? true;
  }

  const date = todayDateOnly();
  const now = new Date();

  const existing = await prisma.attendanceRecord.findUnique({
    where: { employeeId_date: { employeeId, date } },
  });

  if (!existing?.clockInRaw) {
    return fail(ErrorCode.CONFLICT, "Must clock in before clocking out.", 409);
  }

  // Clocking out closes the OPEN session, not the day: the employee is free to
  // clock in again afterwards. Without an open session there is nothing to
  // close — they are already out.
  const open = await findOpenSession(existing.id);
  if (!open) {
    return fail(ErrorCode.CONFLICT, "Already clocked out today.", 409);
  }
  await prisma.attendanceSession.update({
    where: { id: open.id },
    data: { clockOut: now },
  });

  // Worked time is the sum of the day's sessions, never last-out minus
  // first-in — the gap between sessions is a break, and paying it would make
  // stepping out for two hours worth the same as working them.
  const sessions = await prisma.attendanceSession.findMany({
    where: { recordId: existing.id },
    select: { clockIn: true, clockOut: true },
  });
  const { totalHours, isHalfDay } = summariseSessions(sessions);

  const record = await prisma.attendanceRecord.update({
    where: { id: existing.id },
    data: { clockOutRaw: now, totalHours, isHalfDay },
  });

  // EOD wrap-up. Best-effort notifications — never fail the clock-out itself if
  // the summary/notification has trouble.
  const eod = await buildEodSummary(employeeId, date);

  // Stepping out mid-day: the caller still gets the figures back (the UI shows
  // the day so far), but nobody is notified that the day is over, because it
  // isn't.
  if (!endOfDay) {
    return ok({ record, eod, endOfDay: false });
  }

  // Self gets their own wrap-up.
  if (session.userId) {
    await pushNotification(
      session.userId,
      "eod_summary",
      `EOD: completed ${eod.completedCount}/${eod.plannedCount} planned task(s)` +
        (eod.inReviewCount > 0 ? `, ${eod.inReviewCount} awaiting review` : "") +
        (eod.pointsEarnedToday > 0 ? `, +${eod.pointsEarnedToday} pts today.` : "."),
    ).catch(() => {});
  }

  // Management gets the report: all Admin + HR, plus the clocker's team lead —
  // minus the clocker themselves. (A lead's own team-lead is themselves, so a
  // lead's EOD reaches only Admin + HR; an employee's reaches Admin + HR + lead.)
  await notifyEodToManagement(employeeId, session.userId, eod).catch(() => {});

  return ok({ record, eod, endOfDay: true });
}

async function notifyEodToManagement(
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
    (eod.pointsEarnedToday > 0 ? `, +${eod.pointsEarnedToday} pts today.` : ".");

  await Promise.allSettled(
    recipients.map((u) => pushNotification(u.id, "eod_report", message, "EOD report")),
  );
}
