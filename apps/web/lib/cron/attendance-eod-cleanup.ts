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
 * 3. Suspected Reversed Punches (2026-08-12): a device-synced day whose ONLY
 *    punch is still open and implausibly late for a first arrival is not
 *    auto-closed with a fabricated default — see isSuspectedReversedPunch's
 *    doc comment. Flagged for Admin/HR to resolve via PATCH .../edit instead.
 */
export async function runAttendanceEodCleanup(): Promise<{
  autoClockedOut: number;
  deletedPhantoms: number;
  flaggedForReview: number;
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
  let flaggedForReview = 0;
  for (const record of incompleteRecords) {
    // Already flagged on a prior night's run — leave it for Admin/HR to
    // resolve via PATCH .../edit rather than re-notifying every night.
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
      const reason = `Single device punch at ${soleSession.clockIn.toISOString()} with no matching pair — implausibly late to be a first arrival, more likely the day's clock-out misread as a clock-in (the vendor feed has no IN/OUT flag). Needs manual correction via Edit.`;
      await prisma.attendanceRecord.update({
        where: { id: record.id },
        data: { flaggedForReview: true, flagReason: reason },
      });
      await notifyFinanceUsers(
        "attendance.needs_review",
        `${record.employee?.fullName ?? "An employee"}'s attendance on ${record.date.toISOString().slice(0, 10)} has an unmatched device punch and needs manual review.`,
        "Attendance needs review",
      );
      await audit({
        action: "attendance.flag_review",
        entityType: "attendance_record",
        entityId: record.id,
        metadata: { employee_id: record.employeeId, date: record.date.toISOString().slice(0, 10), reason },
      });
      flaggedForReview += 1;
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

  return { autoClockedOut, deletedPhantoms, flaggedForReview };
}
