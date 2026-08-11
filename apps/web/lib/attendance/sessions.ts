import { prisma } from "@/lib/db/prisma";
import { todayDateOnly, FULL_DAY_HOURS } from "@/lib/attendance/time";

// Session arithmetic for a day that can be clocked in and out more than once
// (2026-08-11). Clock-out used to end the day permanently — an employee who
// stepped out at lunch could not come back, and could not log any progress for
// the rest of the day. Now each stretch of work is its own AttendanceSession
// and the day's worked time is their SUM, so a break is never paid as work.
//
// Everything that needs "how long did they actually work" must go through
// here rather than subtracting clock_out_raw from clock_in_raw — that
// difference is the span of the day, breaks included.

export type SessionSpan = { clockIn: Date; clockOut: Date | null };

/** Total worked hours across a day's CLOSED sessions, 2dp. An open session
 *  contributes nothing: the time isn't worked until it's finished. */
export function sumSessionHours(sessions: SessionSpan[]): number {
  const ms = sessions.reduce((acc, s) => {
    if (!s.clockOut) return acc;
    return acc + Math.max(0, s.clockOut.getTime() - s.clockIn.getTime());
  }, 0);
  return Math.round((ms / 3_600_000) * 100) / 100;
}

/** Worked hours plus the half-day verdict, using the same threshold a
 *  single-session day uses (see computeHours). */
export function summariseSessions(sessions: SessionSpan[]): {
  totalHours: number;
  isHalfDay: boolean;
} {
  const totalHours = sumSessionHours(sessions);
  return { totalHours, isHalfDay: totalHours > 0 && totalHours < FULL_DAY_HOURS };
}

/** The day's bounds: first punch in (what late-arrival is measured from) and
 *  last punch out — null while any session is still open. */
export function sessionBounds(sessions: SessionSpan[]): {
  firstIn: Date | null;
  lastOut: Date | null;
} {
  if (sessions.length === 0) return { firstIn: null, lastOut: null };
  const sorted = [...sessions].sort((a, b) => a.clockIn.getTime() - b.clockIn.getTime());
  const firstIn = sorted[0]!.clockIn;
  const anyOpen = sorted.some((s) => !s.clockOut);
  if (anyOpen) return { firstIn, lastOut: null };
  const lastOut = sorted.reduce<Date | null>(
    (acc, s) => (acc && acc.getTime() >= s.clockOut!.getTime() ? acc : s.clockOut!),
    null,
  );
  return { firstIn, lastOut };
}

/** The one open session on a record, or null. The routes keep at most one. */
export async function findOpenSession(recordId: string) {
  return prisma.attendanceSession.findFirst({
    where: { recordId, clockOut: null },
    orderBy: { clockIn: "desc" },
  });
}

/** Is this employee clocked in *right now* — i.e. does today's record have an
 *  open session? This is the gate on logging any work progress. */
export async function hasOpenSessionToday(employeeId: string): Promise<boolean> {
  const record = await prisma.attendanceRecord.findUnique({
    where: { employeeId_date: { employeeId, date: todayDateOnly() } },
    select: { id: true },
  });
  if (!record) return false;
  return (await findOpenSession(record.id)) !== null;
}
