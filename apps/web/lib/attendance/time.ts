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

/**
 * Waives a late-arrival deduction when the employee made up the exact lost
 * time by staying correspondingly late (owner request, 2026-08-12): a
 * shift of 11:00-19:00 with an 11:30 arrival (30 min late) is waived if
 * clock-out is at/after 19:30 — shift-end plus however late they were.
 * Lateness is measured from the same start+grace cutoff isLateArrival uses,
 * so this never fires for an arrival that wasn't actually late in the first
 * place. Requires both expectedStartTime and expectedEndTime to be
 * configured and a clock-out to exist (an incomplete day can't be judged) —
 * missing either simply means no waiver, not an error.
 */
export function isLateWaivedByMakeup(
  clockIn: Date,
  clockOut: Date | null,
  expectedStartTime: string | null,
  expectedEndTime: string | null,
  graceMinutes = 0,
): boolean {
  if (!clockOut || !expectedStartTime || !expectedEndTime) return false;
  const cutoff = parseHHMM(expectedStartTime) + graceMinutes;
  const arrivalMinutes = clockIn.getHours() * 60 + clockIn.getMinutes();
  const lateMinutes = arrivalMinutes - cutoff;
  if (lateMinutes <= 0) return false; // not actually late

  const requiredDepartureMinutes = parseHHMM(expectedEndTime) + lateMinutes;
  const departureMinutes = clockOut.getHours() * 60 + clockOut.getMinutes();
  return departureMinutes >= requiredDepartureMinutes;
}

/** Below this many hours a day is a half-day; at or above it, a full day. */
export const FULL_DAY_HOURS = 5;

/**
 * A day this long is almost certainly bad data, not a real shift (2026-08-12,
 * after a pending record was found on-screen at 14.39h with a clock-out timestamped
 * into the next calendar day). Company default shift is 8h; 14h is nearly double
 * that with room for genuine occasional overtime. Anything past this should never
 * be silently approved — see isImplausibleDuration's call sites, which flag the
 * record for review (clock-out/device sync — a real action, can't be rejected) or
 * reject outright pending explicit confirmation (manual/bulk/edit — a human typing
 * a time, most likely a same-day-vs-next-day slip).
 */
export const MAX_PLAUSIBLE_SHIFT_HOURS = 14;

export function isImplausibleDuration(totalHours: number | null | undefined): boolean {
  return totalHours != null && totalHours > MAX_PLAUSIBLE_SHIFT_HOURS;
}

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
 * Uses the record's date and the team's expectedEndTime (company default
 * 19:00 — an 11:00-19:00, 8h shift), or the shift's own length after
 * clockIn if clockIn was already past the standard end time.
 */
export function getDefaultClockOut(
  dateOrClockIn: Date,
  expectedStartTime: string | null = "11:00",
  expectedEndTime: string | null = "19:00",
): Date {
  const base = new Date(dateOrClockIn);
  const startMinutes =
    expectedStartTime && isValidHHMM(expectedStartTime) ? parseHHMM(expectedStartTime) : parseHHMM("11:00");
  const endMinutes =
    expectedEndTime && isValidHHMM(expectedEndTime) ? parseHHMM(expectedEndTime) : parseHHMM("19:00");
  // Shift length drives the "clocked in after standard end time" fallback
  // below, so it always matches this team's actual configured shift instead
  // of a hardcoded 8/9h guess. Guards against a misconfigured end<=start.
  const shiftMinutes = endMinutes > startMinutes ? endMinutes - startMinutes : 8 * 60;

  const defaultOut = new Date(base);
  defaultOut.setHours(Math.floor(endMinutes / 60), endMinutes % 60, 0, 0);

  // If clockIn is on the same day and happened after the default end time,
  // set default clock-out to one shift-length after clockIn.
  if (defaultOut.getTime() <= base.getTime()) {
    return new Date(base.getTime() + shiftMinutes * 60 * 1000);
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
  return dateOnly(new Date());
}

/** Same local-calendar-fields conversion as todayDateOnly, generalized to any
 *  instant — used to bucket a device punch timestamp onto the @db.Date row it
 *  belongs to. */
export function dateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

// Grace window (2026-08-12) for the reversed-punch heuristic below: how far
// past the expected start time a device day's SOLE punch can still plausibly
// be a genuine (if late) first arrival, before it's flagged as more likely a
// missed clock-in whose only punch was actually the clock-out.
const REVERSED_PUNCH_GRACE_MINUTES = 4 * 60;

/**
 * Heuristic used by the EOD cleanup cron: the TeamOffice feed carries no
 * IN/OUT flag, only punch timestamps, so reconcile.ts infers direction
 * purely by position (odd=in, even=out — see reconcile.ts pairPunches). A
 * day left with exactly one, still-open, device-sourced punch at end-of-day
 * is genuinely ambiguous — it could be a real forgotten clock-out (present
 * all day, punch device caught only the morning), or it could be a missed
 * clock-in whose only punch was actually the evening clock-out, misread as
 * an "in" for lack of any other punch to pair against.
 *
 * This can never be certain from timestamps alone, so it is deliberately a
 * heuristic flag for a human to resolve (via PATCH .../edit), not an
 * auto-correction — guessing wrong here would silently fabricate pay.
 */
export function isSuspectedReversedPunch(
  clockIn: Date,
  isOnlySessionOfDay: boolean,
  expectedStartTime: string | null,
): boolean {
  if (!isOnlySessionOfDay) return false;
  const cutoff = parseHHMM(expectedStartTime ?? "11:00") + REVERSED_PUNCH_GRACE_MINUTES;
  const clockInMinutes = clockIn.getHours() * 60 + clockIn.getMinutes();
  return clockInMinutes > cutoff;
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

