import { WorkLocation } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { closeSessionAndRecompute } from "@/lib/attendance/close-session";
import { pushNotification } from "@/lib/notifications/push";
import { audit } from "@/lib/audit";
import { createLogger } from "@/lib/log";

const logger = createLogger("wfh-autoclose");

// WFH auto clock-out (2026-10-24, owner request). A WFH session nobody closes —
// someone forgets, or falls asleep after a night's work — used to stay open
// until the next day, which blocked the day's approval (no clock-out) and, once
// the date changed, hid the clock-out button entirely. Now a WFH session that has
// run WFH_MAX_SESSION_HOURS is closed by the system AT that limit (not at the
// moment it is noticed, so forgotten time is never credited), and the employee
// is told they can clock back in — which opens a fresh session with its own
// limit. Office sessions come from the biometric device and are not touched here.
//
// The limit is per continuous session, not per day: stepping out and clocking
// back in is the deliberate way to keep working past it.

export const WFH_MAX_SESSION_HOURS = 8;
const WFH_MAX_SESSION_MS = WFH_MAX_SESSION_HOURS * 3_600_000;

/** The moment an open session started at `clockIn` hits the limit. Pure. */
export function wfhSessionDeadline(clockIn: Date): Date {
  return new Date(clockIn.getTime() + WFH_MAX_SESSION_MS);
}

/** Closes every open WFH session (optionally one employee's) that has run past the
 *  limit. Idempotent and safe to run often — the cron calls it every few minutes
 *  and clock-in/out call it for the one employee so the answer is right in real
 *  time, not up to a cron-interval late. */
export async function autoCloseOverlongWfhSessions(
  now: Date = new Date(),
  employeeId?: string,
): Promise<{ closed: number }> {
  const overdue = await prisma.attendanceSession.findMany({
    where: {
      clockOut: null,
      workLocation: WorkLocation.wfh,
      clockIn: { lte: new Date(now.getTime() - WFH_MAX_SESSION_MS) },
      ...(employeeId ? { record: { employeeId } } : {}),
    },
    include: { record: { select: { id: true, employeeId: true, date: true, employee: { select: { fullName: true, user: { select: { id: true } } } } } } },
  });

  let closed = 0;
  for (const s of overdue) {
    const at = wfhSessionDeadline(s.clockIn);
    const { totalHours } = await closeSessionAndRecompute({
      sessionId: s.id,
      recordId: s.record.id,
      at,
      autoClosed: true,
    });
    closed += 1;

    const userId = s.record.employee?.user?.id;
    if (userId) {
      await pushNotification(
        userId,
        "attendance.auto_clock_out",
        `You were clocked out automatically after ${WFH_MAX_SESSION_HOURS} hours of work from home (day total ${totalHours}h). Clock back in if you're still working.`,
        "Clocked out automatically",
      ).catch(() => {});
    }
    await audit({
      action: "attendance.wfh_auto_clock_out",
      entityType: "attendance_session",
      entityId: s.id,
      metadata: {
        employee_id: s.record.employeeId,
        date: s.record.date.toISOString().slice(0, 10),
        clock_in: s.clockIn.toISOString(),
        clock_out: at.toISOString(),
        day_total_hours: totalHours,
      },
    });
    logger.info("auto clocked out WFH session", { sessionId: s.id, employeeId: s.record.employeeId, totalHours });
  }
  return { closed };
}
