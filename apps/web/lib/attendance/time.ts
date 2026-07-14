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

/** True if `clockIn` is later than the team's "HH:MM" expected start time. */
export function isLateArrival(clockIn: Date, expectedStartTime: string | null): boolean {
  if (!expectedStartTime) return false;
  const arrivalMinutes = clockIn.getHours() * 60 + clockIn.getMinutes();
  return arrivalMinutes > parseHHMM(expectedStartTime);
}

export function computeHours(clockIn: Date, clockOut: Date): { totalHours: number; isHalfDay: boolean } {
  const ms = clockOut.getTime() - clockIn.getTime();
  const totalHours = Math.max(0, Math.round((ms / 3_600_000) * 100) / 100);
  return { totalHours, isHalfDay: totalHours < 5 };
}

/** Server-local "today" as a Date at UTC midnight, matching the @db.Date column. */
export function todayDateOnly(): Date {
  return new Date(new Date().toISOString().slice(0, 10));
}
