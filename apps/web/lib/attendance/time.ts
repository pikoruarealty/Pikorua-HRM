// Track A. Small time-math helpers shared by the Teams (expected_start_time
// validation) and Attendance (hours/half-day/late computation) routes.
//
// Assumption: clock timestamps and a team's expected_start_time are compared
// in server-local time (no multi-timezone support yet) — revisit if the app
// ever needs to span multiple office timezones.

export const HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidHHMM(value: string): boolean {
  return HHMM_REGEX.test(value);
}

function parseHHMM(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

/**
 * True if `clockIn` is later than the team's "HH:MM" expected start time plus
 * an optional grace window (minutes, from PayrollConfig.lateGraceMinutes).
 * graceMinutes 0 = exact-to-the-minute (the prior behaviour).
 */
export function isLateArrival(
  clockIn: Date,
  expectedStartTime: string | null,
  graceMinutes = 0,
): boolean {
  if (!expectedStartTime) return false;
  const arrivalMinutes = clockIn.getHours() * 60 + clockIn.getMinutes();
  return arrivalMinutes > parseHHMM(expectedStartTime) + graceMinutes;
}

/** Below this many hours a day is a half-day; at or above it, a full day. */
export const FULL_DAY_HOURS = 5;

export function computeHours(clockIn: Date, clockOut: Date): { totalHours: number; isHalfDay: boolean } {
  const ms = clockOut.getTime() - clockIn.getTime();
  const totalHours = Math.max(0, Math.round((ms / 3_600_000) * 100) / 100);
  // Anything worked below the full-day threshold is a half-day. There used to
  // be a 1.5h floor below which a day was "not a half-day" — but nothing ever
  // implemented the other half of that idea, so a day *under* the floor fell
  // through as isHalfDay=false and was paid as a FULL day: clocking in and
  // straight back out earned more than working four hours. A short day is now
  // uniformly worth half. Zero (or a bad manual edit that inverts the times)
  // is worth nothing — see dayCredit().
  return { totalHours, isHalfDay: totalHours > 0 && totalHours < FULL_DAY_HOURS };
}

/**
 * Computes default clock-out Date for an attendance record.
 * Uses the record's date and the team's expectedStartTime + 9 hours (default 20:00),
 * or 8 hours after clockIn if clockIn was after the standard end time.
 */
export function getDefaultClockOut(
  dateOrClockIn: Date,
  expectedStartTime: string | null = "11:00",
): Date {
  const base = new Date(dateOrClockIn);
  let endHour = 20; // 8:00 PM default (11:00 AM + 9 hours)
  let endMinute = 0;

  if (expectedStartTime && isValidHHMM(expectedStartTime)) {
    const [h, m] = expectedStartTime.split(":").map(Number);
    const totalMinutes = h * 60 + m + 9 * 60; // 9-hour workday standard
    endHour = Math.floor(totalMinutes / 60) % 24;
    endMinute = totalMinutes % 60;
  }

  const defaultOut = new Date(base);
  defaultOut.setHours(endHour, endMinute, 0, 0);

  // If clockIn is on the same day and happened after the default end time,
  // set default clock-out to 8 hours after clockIn.
  if (defaultOut.getTime() <= base.getTime()) {
    return new Date(base.getTime() + 8 * 3600 * 1000);
  }

  return defaultOut;
}

/** Server-local "today" as a Date at UTC midnight, matching the @db.Date column.
 *
 *  Built from the server's LOCAL calendar fields, not from toISOString(). In any
 *  timezone ahead of UTC (IST is +5:30) the ISO form rolls back to yesterday for
 *  the whole early-morning window — someone clocking in at 03:00 IST was filed
 *  against the previous day, colliding with the record they already have there.
 *  Everything else that asks "what day is it" (lastElapsedDay in
 *  monthly-breakdown.ts) already uses local fields, so this makes the pair
 *  agree. */
export function todayDateOnly(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/** How much of a working day one attendance record is worth. */
export type DayCredit = 0 | 0.5 | 1;

/**
 * The single place that decides what a day of attendance is worth, so payroll,
 * the monthly breakdown and the performance score cannot disagree.
 *
 * `totalHours` is null while the day is still open (clocked in, not yet out) —
 * an in-progress day counts as present; it is not the employee's fault the day
 * has not finished. A recorded day of zero (or negative, from a bad manual
 * edit) is worth nothing: previously it fell through `isHalfDay === false` and
 * was paid as a full day, so a five-minute clock-in/clock-out earned a whole
 * day's wages.
 */
export function dayCredit(
  totalHours: number | null | undefined,
  isHalfDay: boolean,
): DayCredit {
  if (totalHours == null) return 1;
  if (totalHours <= 0) return 0;
  return isHalfDay ? 0.5 : 1;
}

