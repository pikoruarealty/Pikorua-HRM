import { prisma } from "@/lib/db/prisma";
import { isImplausibleDuration } from "@/lib/attendance/time";
import { sessionBounds, summariseSessions } from "@/lib/attendance/sessions";

// The one place a session is closed and its day's figures re-derived. Used by
// the clock-out route and by the WFH auto clock-out (wfh-autoclose.ts) so a
// self clock-out and a system one can never compute a day differently.

export type ClosedSessionResult = {
  record: Awaited<ReturnType<typeof prisma.attendanceRecord.update>>;
  totalHours: number;
  isHalfDay: boolean;
};

/**
 * Closes `sessionId` at `at`, then rewrites its record's clock-out, worked hours
 * and half-day verdict from ALL the day's sessions.
 *
 * Worked time is the sum of the sessions, never last-out minus first-in — the gap
 * between sessions is a break. The record written to is the one that owns the
 * session, which is the day it was OPENED on even when `at` is already the next
 * calendar day (a night-time WFH session).
 *
 * A day this long is almost certainly a forgotten clock-out rather than a real
 * shift — flag it so /approve refuses it until Admin/HR looks (see
 * isImplausibleDuration). An existing, still-unresolved flag is never overwritten.
 */
export async function closeSessionAndRecompute(opts: {
  sessionId: string;
  recordId: string;
  at: Date;
  autoClosed?: boolean;
}): Promise<ClosedSessionResult> {
  await prisma.attendanceSession.update({
    where: { id: opts.sessionId },
    data: { clockOut: opts.at, ...(opts.autoClosed ? { autoClosed: true } : {}) },
  });

  const sessions = await prisma.attendanceSession.findMany({
    where: { recordId: opts.recordId },
    select: { clockIn: true, clockOut: true },
  });
  const { totalHours, isHalfDay } = summariseSessions(sessions);
  const { lastOut } = sessionBounds(sessions);

  const existing = await prisma.attendanceRecord.findUniqueOrThrow({
    where: { id: opts.recordId },
    select: { flaggedForReview: true },
  });
  const implausible = isImplausibleDuration(totalHours);

  const record = await prisma.attendanceRecord.update({
    where: { id: opts.recordId },
    data: {
      clockOutRaw: lastOut ?? opts.at,
      totalHours,
      isHalfDay,
      ...(implausible && !existing.flaggedForReview
        ? {
            flaggedForReview: true,
            flagReason: `Worked ${totalHours}h, well beyond a normal shift — likely a forgotten clock-out. Needs manual review via Edit before it can be approved.`,
          }
        : {}),
    },
  });

  return { record, totalHours, isHalfDay };
}
