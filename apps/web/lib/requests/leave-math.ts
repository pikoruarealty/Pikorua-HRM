// Pure date math behind getApprovedUnpaidLeaveDays (lib/requests/leave.ts),
// extracted so the period-clipping rule is unit-testable without a DB
// (production hardening, 2026-07-15). Semantics unchanged from the 2.4b
// implementation: both bounds inclusive, dates are @db.Date (UTC midnight),
// a range spanning a month boundary contributes only its in-period days.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** What one day of a half-day leave row is worth (2026-10-01). */
export const HALF_DAY_WEIGHT = 0.5;

/** [start, end] of the period as inclusive UTC-midnight dates (month 1-12). */
export function periodBounds(month: number, year: number): { start: Date; lastDay: Date } {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const lastDay = new Date(Date.UTC(year, month, 1) - MS_PER_DAY);
  return { start, lastDay };
}

/** Day count of [dateFrom, dateTo] clipped to the given period (inclusive);
 *  0 if the range doesn't overlap the period at all. A half-day row counts each
 *  of its days as half a day — in practice it is exactly one day, so 0.5. */
export function countDaysClippedToPeriod(
  dateFrom: Date,
  dateTo: Date,
  month: number,
  year: number,
  halfDay = false,
): number {
  const { start: periodStart, lastDay: periodLastDay } = periodBounds(month, year);
  const start = dateFrom < periodStart ? periodStart : dateFrom;
  const end = dateTo > periodLastDay ? periodLastDay : dateTo;
  const days = Math.floor((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
  return days > 0 ? days * (halfDay ? HALF_DAY_WEIGHT : 1) : 0;
}

/** [start, end] of the calendar year as inclusive UTC-midnight dates. */
export function yearBounds(year: number): { start: Date; lastDay: Date } {
  const start = new Date(Date.UTC(year, 0, 1));
  const lastDay = new Date(Date.UTC(year + 1, 0, 1) - MS_PER_DAY);
  return { start, lastDay };
}

/** Same as countDaysClippedToPeriod but clipped to a whole calendar year
 *  (2026-08-07, leave-balance feature) — used for the yearly allowance. */
export function countDaysClippedToYear(dateFrom: Date, dateTo: Date, year: number, halfDay = false): number {
  const { start: yearStart, lastDay: yearLastDay } = yearBounds(year);
  const start = dateFrom < yearStart ? yearStart : dateFrom;
  const end = dateTo > yearLastDay ? yearLastDay : dateTo;
  const days = Math.floor((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
  return days > 0 ? days * (halfDay ? HALF_DAY_WEIGHT : 1) : 0;
}

// Leave-type overhaul (2026-09-06, owner request): leave_paid retired in
// favor of leave_casual/leave_sick, sharing one combined balance pool
// (12/year, max 2/month — LeaveConfig's numeric caps are unchanged, only the
// type names split). leave_unpaid is unchanged.
export const PAID_LEAVE_TYPES = ["leave_casual", "leave_sick"] as const;
export type PaidLeaveType = (typeof PAID_LEAVE_TYPES)[number];
export type LeaveDayType = PaidLeaveType | "leave_unpaid";
export function isPaidLeaveType(type: string): type is PaidLeaveType {
  return (PAID_LEAVE_TYPES as readonly string[]).includes(type);
}

export type LeaveSegment = {
  dateFrom: Date;
  dateTo: Date;
  type: LeaveDayType;
  /** Present (and true) only on a half-day row; omitted for whole days. */
  halfDay?: true;
};

/** One leave type on one date, whole or half. A date can carry two parts — a
 *  paid half and an unpaid half — when a paid-leave cap runs out mid-day. */
export type LeavePart = { date: string; type: LeaveDayType; half: boolean };

export type LeaveCaps = {
  /** "YYYY-MM" -> paid days already approved that calendar month. */
  approvedPaidByMonthKey: Map<string, number>;
  /** Paid days already approved in the year of dateFrom. */
  approvedPaidThisYear: number;
  monthlyCap: number;
  yearlyCap: number;
};

/**
 * Turns one leave request into the day-by-day parts that get approved. It is the
 * single place half-days, manual per-day type changes and the paid-leave caps
 * meet, so they cannot disagree.
 *
 * - Every date starts at the request's `baseType`, whole — or half if the request
 *   itself is a half-day request (`baseHalf`) or the approver is approving that
 *   date as a half day (`halfDates`, owner request 2026-10-01: Admin/HR can approve
 *   a full-day leave as a half day).
 * - `typeOverrides` (owner request 2026-09-01) flips individual dates to another
 *   leave type, e.g. paid -> unpaid.
 * - `caps` (2026-09-06, "if the leave has exceeded [2/month], then only it becomes
 *   unpaid"): a paid day that no longer fits under the monthly or annual allowance
 *   becomes unpaid. With half-days a whole day can *partly* fit — one half-day of
 *   allowance left — and is then split into a paid half and an unpaid half rather
 *   than being refused the half it was entitled to or overdrawing the allowance.
 *   Callers pass `caps` only when no manual overrides apply (a manual split wins).
 *
 * `approvedPaidByMonthKey` lets a request spanning a month boundary reset its
 * monthly count per calendar month. `approvedPaidThisYear` is one running total for
 * the year of dateFrom — a request straddling Dec 31 tracks the annual cap slightly
 * imprecisely (known, acceptable: it only matters for leave that literally spans
 * New Year).
 */
export function planLeaveParts(args: {
  dateFrom: Date;
  dateTo: Date;
  baseType: LeaveDayType;
  baseHalf?: boolean;
  halfDates?: Set<string>;
  typeOverrides?: Map<string, LeaveDayType>;
  caps?: LeaveCaps | null;
}): LeavePart[] {
  const { dateFrom, dateTo, baseType, baseHalf = false, halfDates, typeOverrides, caps } = args;
  const parts: LeavePart[] = [];
  const totalDays = Math.floor((dateTo.getTime() - dateFrom.getTime()) / MS_PER_DAY) + 1;
  const monthUsage = new Map(caps?.approvedPaidByMonthKey ?? []);
  let yearUsage = caps?.approvedPaidThisYear ?? 0;

  for (let i = 0; i < totalDays; i++) {
    const date = new Date(dateFrom.getTime() + i * MS_PER_DAY);
    const key = date.toISOString().slice(0, 10);
    const half = baseHalf || (halfDates?.has(key) ?? false);
    const weight = half ? HALF_DAY_WEIGHT : 1;
    const type = typeOverrides?.get(key) ?? baseType;

    if (caps && isPaidLeaveType(type)) {
      const monthKey = key.slice(0, 7);
      const usedThisMonth = monthUsage.get(monthKey) ?? 0;
      const room = Math.min(caps.monthlyCap - usedThisMonth, caps.yearlyCap - yearUsage);
      if (room >= weight) {
        parts.push({ date: key, type, half });
        monthUsage.set(monthKey, usedThisMonth + weight);
        yearUsage += weight;
      } else if (!half && room >= HALF_DAY_WEIGHT) {
        parts.push({ date: key, type, half: true });
        parts.push({ date: key, type: "leave_unpaid", half: true });
        monthUsage.set(monthKey, usedThisMonth + HALF_DAY_WEIGHT);
        yearUsage += HALF_DAY_WEIGHT;
      } else {
        parts.push({ date: key, type: "leave_unpaid", half });
      }
      continue;
    }

    parts.push({ date: key, type, half });
  }

  return parts;
}

/** Coalesces day parts into the Request rows to store: one row per contiguous run
 *  of the same (type, whole/half). Rows come back in date order, so the first can
 *  reuse the request being approved and the rest become new approved rows. */
export function partsToSegments(parts: LeavePart[]): LeaveSegment[] {
  const segments: LeaveSegment[] = [];
  const open = new Map<string, LeaveSegment>();
  for (const part of parts) {
    const date = new Date(`${part.date}T00:00:00.000Z`);
    const key = `${part.type}|${part.half ? "h" : "w"}`;
    const current = open.get(key);
    if (current && date.getTime() - current.dateTo.getTime() === MS_PER_DAY) {
      current.dateTo = date;
      continue;
    }
    const seg: LeaveSegment = {
      dateFrom: date,
      dateTo: date,
      type: part.type,
      ...(part.half ? { halfDay: true as const } : {}),
    };
    open.set(key, seg);
    segments.push(seg);
  }
  return segments.sort(
    (a, b) => a.dateFrom.getTime() - b.dateFrom.getTime() || (a.halfDay ? 1 : 0) - (b.halfDay ? 1 : 0),
  );
}

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
  return partsToSegments(planLeaveParts({ dateFrom, dateTo, baseType, typeOverrides: overrides }));
}

/** How much of one calendar day is leave, by kind (2026-10-01). Each is 0..1 and
 *  together they never exceed 1, so a day can never be counted as more than one
 *  day of leave however many rows touch it. */
export type LeaveDayEntry = { paid: number; unpaid: number };

/** Adds one leave row's contribution to a date's entry. Overlapping rows (two
 *  requests for the same day) used to overwrite each other arbitrarily; they now
 *  add up and are capped at one whole day, paid taking precedence over unpaid. */
export function addLeaveToDay(
  days: Map<string, LeaveDayEntry>,
  dateKey: string,
  type: string,
  halfDay: boolean,
): void {
  const weight = halfDay ? HALF_DAY_WEIGHT : 1;
  const cur = days.get(dateKey) ?? { paid: 0, unpaid: 0 };
  if (isPaidLeaveType(type)) cur.paid = Math.min(1, cur.paid + weight);
  else cur.unpaid = Math.min(1, cur.unpaid + weight);
  cur.unpaid = Math.min(cur.unpaid, 1 - cur.paid);
  days.set(dateKey, cur);
}
