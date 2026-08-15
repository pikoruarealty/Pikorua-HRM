import { prisma } from "@/lib/db/prisma";
import { todayDateOnly, getDefaultClockOut, isSuspectedReversedPunch } from "@/lib/attendance/time";
import { summariseSessions } from "@/lib/attendance/sessions";
import { notifyFinanceUsers } from "@/lib/notifications/push";
import { audit } from "@/lib/audit";
import { AttendanceSource, Prisma } from "@prisma/client";

/**
 * End-of-day attendance maintenance and dangling request cleanup.
 * Runs daily at midnight UTC (and on server startup).
 * 
 * 1. Dangling Phantom Records: Deletes attendance records for past dates that have
 *    neither a clock-in nor a clock-out (empty placeholders/unwanted rows).
 * 2. Missing Clock-Out Records: For any past attendance record left with an open
 *    session (clocked in, never clocked out), auto-populates the default clock-out
 *    time (the team's configured shift end, company default 19:00) and
 *    re-sums the day's sessions so the record is complete and ready for standard
 *    approval.
 * 3. Suspected Reversed Punches (2026-08-12, resolution changed 2026-08-15):
 *    a device-synced day whose ONLY punch is still open and implausibly late
 *    for a first arrival is never auto-closed with a fabricated default clock
 *    -out — see isSuspectedReversedPunch's doc comment. Instead it's
 *    reinterpreted as that punch being the day's clock-out with no clock-in
 *    (the far more common real cause — a missed morning punch), flagged for
 *    Admin/HR visibility, and notified — not silently left half-fixed.
 */
export async function runAttendanceEodCleanup(): Promise<{
  autoClockedOut: number;
  deletedPhantoms: number;
  reversedPunchesResolved: number;
}> {
  const today = todayDateOnly();

  // 1. Delete empty phantom records on or before yesterday
  const phantoms = await prisma.attendanceRecord.findMany({
    where: {
      date: { lt: today },
      clockInRaw: null,
      clockInApproved: null,
      clockOutRaw: null,
      clockOutApproved: null,
    },
    select: { id: true },
  });

  let deletedPhantoms = 0;
  if (phantoms.length > 0) {
    const res = await prisma.attendanceRecord.deleteMany({
      where: { id: { in: phantoms.map((p) => p.id) } },
    });
    deletedPhantoms = res.count;
  }

  // 2. Auto-clock-out past days left open. "Open" means a session with no
  //    clock-out — a day can have several sessions since 2026-08-11, and only
  //    the last one is ever left hanging. The default clock-out is derived from
  //    that session's own start, not the day's first punch in, so someone who
  //    came back at 16:00 and forgot to leave isn't credited from the morning.
  const incompleteRecords = await prisma.attendanceRecord.findMany({
    where: {
      date: { lt: today },
      sessions: { some: { clockOut: null } },
    },
    include: {
      sessions: { select: { id: true, clockIn: true, clockOut: true } },
      employee: {
        select: {
          id: true,
          fullName: true,
          team: { select: { expectedStartTime: true, expectedEndTime: true } },
        },
      },
    },
  });

  let autoClockedOut = 0;
  let reversedPunchesResolved = 0;
  for (const record of incompleteRecords) {
    // Already flagged on a prior night's run — leave whatever Admin/HR is
    // already looking at alone rather than re-touching it every night.
    if (record.flaggedForReview) continue;

    const expectedStart = record.employee?.team?.expectedStartTime ?? "11:00";
    const expectedEnd = record.employee?.team?.expectedEndTime ?? "19:00";

    const soleSession = record.sessions.length === 1 ? record.sessions[0]! : null;
    if (
      record.source === AttendanceSource.device_sync &&
      soleSession &&
      !soleSession.clockOut &&
      isSuspectedReversedPunch(soleSession.clockIn, true, expectedStart)
    ) {
      // Reinterpret: the sole punch was the clock-out, not a clock-in — so
      // there is no real session to keep (a session requires a clockIn, and
      // the one we have isn't genuine). Delete it and record the day as
      // clock-out-only: no worked hours, pending Admin/HR approval (a guess,
      // not a fact) rather than auto-approved.
      const reason = `Single device punch at ${soleSession.clockIn.toISOString()} with no matching pair — implausibly late to be a first arrival, so auto-reinterpreted as the day's clock-out with no clock-in (the vendor feed has no IN/OUT flag to confirm this). Verify via Edit.`;
      await prisma.$transaction([
        prisma.attendanceSession.delete({ where: { id: soleSession.id } }),
        prisma.attendanceRecord.update({
          where: { id: record.id },
          data: {
            clockInRaw: null,
            clockOutRaw: soleSession.clockIn,
            totalHours: new Prisma.Decimal(0),
            isHalfDay: false,
            approvalStatus: "pending",
            flaggedForReview: true,
            flagReason: reason,
          },
        }),
      ]);
      await notifyFinanceUsers(
        "attendance.needs_review",
        `${record.employee?.fullName ?? "An employee"}'s attendance on ${record.date.toISOString().slice(0, 10)} had an unmatched device punch, auto-corrected to clock-out-only — please verify.`,
        "Attendance auto-corrected, please verify",
      );
      await audit({
        action: "attendance.auto_correct_reversed_punch",
        entityType: "attendance_record",
        entityId: record.id,
        metadata: { employee_id: record.employeeId, date: record.date.toISOString().slice(0, 10), reason },
      });
      reversedPunchesResolved += 1;
      continue;
    }

    const closed = record.sessions.map((s) => ({
      ...s,
      clockOut: s.clockOut ?? getDefaultClockOut(s.clockIn, expectedStart, expectedEnd),
    }));

    const { totalHours, isHalfDay } = summariseSessions(closed);
    const lastOut = closed.reduce<Date>(
      (acc, s) => (s.clockOut.getTime() > acc.getTime() ? s.clockOut : acc),
      closed[0]!.clockOut,
    );

    await prisma.$transaction([
      ...record.sessions
        .filter((s) => !s.clockOut)
        .map((s) =>
          prisma.attendanceSession.update({
            where: { id: s.id },
            data: { clockOut: closed.find((c) => c.id === s.id)!.clockOut },
          }),
        ),
      prisma.attendanceRecord.update({
        where: { id: record.id },
        data: {
          clockOutRaw: lastOut,
          totalHours: new Prisma.Decimal(totalHours),
          isHalfDay,
        },
      }),
    ]);
    autoClockedOut += 1;
  }

  return { autoClockedOut, deletedPhantoms, reversedPunchesResolved };
}
