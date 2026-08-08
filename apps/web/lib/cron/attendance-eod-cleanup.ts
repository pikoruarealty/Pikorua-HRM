import { prisma } from "@/lib/db/prisma";
import { todayDateOnly, computeHours, getDefaultClockOut } from "@/lib/attendance/time";
import { Prisma } from "@prisma/client";

/**
 * End-of-day attendance maintenance and dangling request cleanup.
 * Runs daily at midnight UTC (and on server startup).
 * 
 * 1. Dangling Phantom Records: Deletes attendance records for past dates that have
 *    neither a clock-in nor a clock-out (empty placeholders/unwanted rows).
 * 2. Missing Clock-Out Records: For any past attendance record where an employee
 *    clocked in but forgot to clock out, auto-populates the default clock-out time
 *    (based on the team's expected start time + 9h, or 20:00 default) and computes
 *    hours so the record is complete and ready for standard approval.
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

  // 2. Auto-clock-out incomplete past records with a clock-in but no clock-out
  const incompleteRecords = await prisma.attendanceRecord.findMany({
    where: {
      date: { lt: today },
      OR: [{ clockInRaw: { not: null } }, { clockInApproved: { not: null } }],
      clockOutRaw: null,
      clockOutApproved: null,
    },
    include: {
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
    const effectiveIn = record.clockInApproved ?? record.clockInRaw;
    if (!effectiveIn) continue;

    const defaultOut = getDefaultClockOut(
      effectiveIn,
      record.employee?.team?.expectedStartTime ?? "11:00",
    );
    const { totalHours, isHalfDay } = computeHours(effectiveIn, defaultOut);

    await prisma.attendanceRecord.update({
      where: { id: record.id },
      data: {
        clockOutRaw: defaultOut,
        totalHours: new Prisma.Decimal(totalHours),
        isHalfDay,
      },
    });
    autoClockedOut += 1;
  }

  return { autoClockedOut, deletedPhantoms };
}
