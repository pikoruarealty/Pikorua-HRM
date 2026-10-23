import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { todayDateOnly } from "@/lib/attendance/time";
import { findOpenSessionForEmployee } from "@/lib/attendance/sessions";
import { closeSessionAndRecompute } from "@/lib/attendance/close-session";
import { autoCloseOverlongWfhSessions, WFH_MAX_SESSION_HOURS } from "@/lib/attendance/wfh-autoclose";
import { buildEodSummary } from "@/lib/eod/summary";
import { ATTENDANCE_EXEMPT_MESSAGE, isAttendanceExemptRole } from "@/lib/attendance/tracking";
import { pushNotification } from "@/lib/notifications/push";
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
  if (isAttendanceExemptRole(session.role)) {
    return failFor(ErrorCode.FORBIDDEN, ATTENDANCE_EXEMPT_MESSAGE);
  }

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

  const now = new Date();

  // A WFH session past its limit is closed by the system first, so the answer
  // below reflects it immediately rather than up to a cron interval late.
  const autoClosed = await autoCloseOverlongWfhSessions(now, employeeId);

  // Clocking out closes the OPEN session, not the day: the employee is free to
  // clock in again afterwards. The session is found wherever it lives, not on
  // today's record — someone working from home past midnight is still clocked in
  // on the date they started, and looking only at today's record made clock-out
  // impossible once the date turned over (2026-10-24).
  const open = await findOpenSessionForEmployee(employeeId);
  if (!open) {
    if (autoClosed.closed > 0) {
      return fail(
        ErrorCode.CONFLICT,
        `You were clocked out automatically after ${WFH_MAX_SESSION_HOURS} hours of work from home. Clock back in if you're still working.`,
        409,
      );
    }
    const today = await prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId, date: todayDateOnly() } },
      select: { clockInRaw: true },
    });
    return fail(
      ErrorCode.CONFLICT,
      today?.clockInRaw ? "Already clocked out today." : "Must clock in before clocking out.",
      409,
    );
  }

  // The session's own day: its hours, flags and the EOD summary all belong to the
  // record it was opened on, even when `now` is already the next calendar day.
  const date = open.record.date;

  // Worked time is the sum of the day's sessions, never last-out minus
  // first-in — the gap between sessions is a break, and paying it would make
  // stepping out for two hours worth the same as working them.
  const { record } = await closeSessionAndRecompute({
    sessionId: open.id,
    recordId: open.record.id,
    at: now,
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

  return ok({ record, eod, endOfDay: true });
}
