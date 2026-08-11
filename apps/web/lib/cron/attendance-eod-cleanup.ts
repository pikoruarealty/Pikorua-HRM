import { prisma } from "@/lib/db/prisma";
import { todayDateOnly, getDefaultClockOut } from "@/lib/attendance/time";
import { summariseSessions } from "@/lib/attendance/sessions";
import { Prisma } from "@prisma/client";

/**
 * End-of-day attendance maintenance and dangling request cleanup.
 * Runs daily at midnight UTC (and on server startup).
 * 
 * 1. Dangling Phantom Records: Deletes attendance records for past dates that have
 *    neither a clock-in nor a clock-out (empty placeholders/unwanted rows).
 * 2. Missing Clock-Out Records: For any past attendance record left with an open
 *    session (clocked in, never clocked out), auto-populates the default clock-out
 *    time (based on the team's expected start time + 9h, or 20:00 default) and
 *    re-sums the day's sessions so the record is complete and ready for standard
 *    approval.
 */
export async function runAttendanceEodCleanup(): Promise<{
  autoClockedOut: number;
  deletedPhantoms: number;
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
          team: { select: { expectedStartTime: true } },
        },
      },
    },
  });

  let autoClockedOut = 0;
  for (const record of incompleteRecords) {
    const expectedStart = record.employee?.team?.expectedStartTime ?? "11:00";
    const closed = record.sessions.map((s) => ({
      ...s,
      clockOut: s.clockOut ?? getDefaultClockOut(s.clockIn, expectedStart),
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

  return { autoClockedOut, deletedPhantoms };
}
