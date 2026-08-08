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

export function computeHours(clockIn: Date, clockOut: Date): { totalHours: number; isHalfDay: boolean } {
  const ms = clockOut.getTime() - clockIn.getTime();
  const totalHours = Math.max(0, Math.round((ms / 3_600_000) * 100) / 100);
  // Half-day is the band (1.5h, 5h): a very short day (<=1.5h) is not a
  // half-day, and >=5h is a full day.
  return { totalHours, isHalfDay: totalHours > 1.5 && totalHours < 5 };
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

/** Server-local "today" as a Date at UTC midnight, matching the @db.Date column. */
export function todayDateOnly(): Date {
  return new Date(new Date().toISOString().slice(0, 10));
}

