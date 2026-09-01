// Pure date math behind getApprovedUnpaidLeaveDays (lib/requests/leave.ts),
// extracted so the period-clipping rule is unit-testable without a DB
// (production hardening, 2026-07-15). Semantics unchanged from the 2.4b
// implementation: both bounds inclusive, dates are @db.Date (UTC midnight),
// a range spanning a month boundary contributes only its in-period days.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** [start, end] of the period as inclusive UTC-midnight dates (month 1-12). */
export function periodBounds(month: number, year: number): { start: Date; lastDay: Date } {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const lastDay = new Date(Date.UTC(year, month, 1) - MS_PER_DAY);
  return { start, lastDay };
}

/** Inclusive day count of [dateFrom, dateTo] clipped to the given period;
 *  0 if the range doesn't overlap the period at all. */
export function countDaysClippedToPeriod(
  dateFrom: Date,
  dateTo: Date,
  month: number,
  year: number,
): number {
  const { start: periodStart, lastDay: periodLastDay } = periodBounds(month, year);
  const start = dateFrom < periodStart ? periodStart : dateFrom;
  const end = dateTo > periodLastDay ? periodLastDay : dateTo;
  const days = Math.floor((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
  return days > 0 ? days : 0;
}

/** [start, end] of the calendar year as inclusive UTC-midnight dates. */
export function yearBounds(year: number): { start: Date; lastDay: Date } {
  const start = new Date(Date.UTC(year, 0, 1));
  const lastDay = new Date(Date.UTC(year + 1, 0, 1) - MS_PER_DAY);
  return { start, lastDay };
}

/** Same as countDaysClippedToPeriod but clipped to a whole calendar year
 *  (2026-08-07, leave-balance feature) — used for the yearly allowance. */
export function countDaysClippedToYear(dateFrom: Date, dateTo: Date, year: number): number {
  const { start: yearStart, lastDay: yearLastDay } = yearBounds(year);
  const start = dateFrom < yearStart ? yearStart : dateFrom;
  const end = dateTo > yearLastDay ? yearLastDay : dateTo;
  const days = Math.floor((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
  return days > 0 ? days : 0;
}

export type LeaveDayType = "leave_paid" | "leave_unpaid";
export type LeaveSegment = { dateFrom: Date; dateTo: Date; type: LeaveDayType };

/** Behind partial leave approval (owner request, 2026-09-01): a leave
 *  request covers [dateFrom, dateTo] as a single `type`, but Admin/HR may
 *  want to approve some days paid and others unpaid within that same range
 *  (e.g. an employee only has 2 paid-leave days left of a 5-day request).
 *  `overrides` maps individual dates (within range) to a different type than
 *  the request's own `baseType`; everything not listed keeps `baseType`.
 *  Returns the coalesced run-length segments in date order — a single
 *  segment covering the whole range when there are no (effective)
 *  overrides, so the common case needs no special-casing by the caller. */
export function splitLeaveRangeByOverrides(
  dateFrom: Date,
  dateTo: Date,
  baseType: LeaveDayType,
  overrides: Map<string, LeaveDayType>,
): LeaveSegment[] {
  const segments: LeaveSegment[] = [];
  const totalDays = Math.floor((dateTo.getTime() - dateFrom.getTime()) / MS_PER_DAY) + 1;

  for (let i = 0; i < totalDays; i++) {
    const date = new Date(dateFrom.getTime() + i * MS_PER_DAY);
    const key = date.toISOString().slice(0, 10);
    const type = overrides.get(key) ?? baseType;

    const last = segments[segments.length - 1];
    if (last && last.type === type) {
      last.dateTo = date;
    } else {
      segments.push({ dateFrom: date, dateTo: date, type });
    }
  }

  return segments;
}
