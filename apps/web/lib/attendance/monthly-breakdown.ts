import { AttendanceApprovalStatus, EmploymentType, Prisma, RequestStatus, RequestType } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { addDays, buildMovedOffDateByWeek, isOffDay, resolveDefaultOffDay, weekStartOf } from "@/lib/attendance/week";
import { dayCredit } from "@/lib/attendance/time";
import { addLeaveToDay, isPaidLeaveType, type LeaveDayEntry } from "@/lib/requests/leave-math";
import { ATTENDANCE_EXEMPT_ROLES } from "@/lib/attendance/tracking";
import { resolveWeekOff, type WeekOff } from "@/lib/attendance/weekly-off";
import {
  BALANCE_WINDOW_DAYS,
  EXTRA_DAY_RULE_FROM,
  addDaysKey,
  dayPlace,
  matchExtraDays,
  type ExtraDay,
  type ExtraDayLedger,
  type ExtraVerdict,
  type MissedUnit,
  type Place,
} from "@/lib/attendance/extra-days";

// Leave-type overhaul (2026-09-06): leave_paid retired in favor of
// leave_casual + leave_sick sharing one combined pool — every "which
// requests count as leave" query below now matches all three leave types
// instead of the old binary pair.
const ALL_LEAVE_TYPES: RequestType[] = [RequestType.leave_casual, RequestType.leave_sick, RequestType.leave_unpaid];

// Track A (2026-07-17). Reporting-only day-by-day attendance classification —
// present/absent/leave/holiday/compensation counts for a calendar month.
// Feeds payslip preview, employee profile, and the admin monthly table.
//
// Weekly-off rule (rewritten 2026-08-08, owner request):
// 1. Full-time employees: have a default off-day (Employee.defaultWeeklyOffDay
//    > Team.defaultWeeklyOffDay > Sunday 0), overridable per week via WeeklyOffMove.
//    Clocking in on an off day counts as a compensation day.
// 2. Part-time / Interns (with requiredDaysPerWeek, e.g. 3 days/week):
//    Flexible schedule: can clock in any days of the week. Quota is evaluated
//    per ISO week. If an employee clocks in more than requiredDaysPerWeek in a
//    week, the extra days count as compensation days! If they clock in fewer
//    days in a completed week, the missing days count as absences. Compensation
//    days add to earnings and naturally offset past absences.
//
// Rewritten 2026-10-01 around ONE rule: every day is walked once and carries its
// own `credit` (what it is worth toward pay, in days); the counts below are tallied
// from that same walk, so tiles, calendar and pay cannot disagree. What changed:
//  - Whole-day counts. A part-timer's week over quota used to move a *fraction* of
//    a day from "present" to "compensation" (1.5), while the calendar could only
//    relabel whole days — so the tiles read 6 present / 7 compensation over a
//    calendar of 7 / 6. Present and compensation are paid identically, so the
//    relabelling is now done on whole worked days and the counts are whole.
//  - Half-day leave. A leave day is worth 1 or 0.5. It fills only the part of the
//    day the employee did not work (`1 - worked`), so a half-day of work plus a
//    half-day leave is one full day — neither lost (the old walk ignored leave on
//    any day with a record) nor counted twice.
//  - Today is not final. A day still open (clocked in, not out) or not started yet
//    is `live` / `today`, never "absent". A device punch auto-approves the day at
//    once with 0 hours until the session closes, which used to read as absent.
//
// 2026-10-24 (owner request): a day worked IN ADVANCE — the weekly off, or a day
// Admin/HR flagged as compensation — is shown as an ordinary PRESENT day (note
// `advance`), not as "Compensation". What it earned lives separately as a balance
// day (a compensation credit, lib/attendance/compensation-credits.ts) usable for
// 60 days. It is pay-neutral: present and compensation have always been worth one
// day each, so `payableDays`/`daysWorked` do not move. `compensationDays` now
// counts only a part-timer's over-quota days (paid, but no balance is earned).
//
// 2026-10-24: a balance day can be USED on purpose for one absent / unpaid-leave day
// (`balanceDates`, from compensation credits with `applied`). That day is then a paid
// day shown as `paid_leave` with note `balance`, counted in `paidLeaveDays` (so pay
// and every total move exactly as for any paid leave) and in `balanceDays`. A balance
// day only ever covers a day with nothing worked and no paid leave on it — it fills
// the room that would otherwise be unpaid leave or absence, never a worked day.
//
// 2026-11-01 (owner rule, lib/attendance/extra-days.ts): from EXTRA_DAY_RULE_FROM an
// extra day (worked weekly off, flagged day, a part-timer's day over quota) is never
// paid as an extra day. If it makes up an earlier missed day it is `compensation`
// (credit 1, `madeUpFor`); otherwise it is shown as present (`advance`, `banked`) with
// credit 0 and banked as a balance day. The walk is told which by `extraVerdicts`,
// computed by the loaders below from every month back to 60 days before the rule
// date, so a missed day last month can be made up this month. Without
// `extraRuleFrom` (unit tests that predate the rule) the old treatment applies.
// (A part-timer's quota was briefly judged on whole Mon–Sun weeks; from the rule month
// on it is monthly — see below.)

// 2026-11-01 (owner, after checking October by hand): a part-timer's quota is MONTHLY
// from the rule month on. A month owes required/6 of its Mon–Sat days that aren't
// holidays (3 days a week: half — October 27 / 2 = 13.5), counted from the joining
// date. Office days worked in the month (Sundays too) count toward it; WFH-only days
// don't (WFH hours). Paid leave fills only what the office days leave short — the
// rest goes back to the leave balance (`paidLeaveUnused`); unpaid leave costs only
// what the month is short. Beyond the quota, extra time banks as balance days in
// steps of 0.5; a short month is covered automatically by earlier balance, else it
// waits to be made up. Weeks are only CHECKED (Mon–Sun, flagged when below the weekly
// days or every day), never paid. The weekly walk below the rule month is unchanged.

/** One Monday–Sunday week of a part-timer, for the weekly check (pay is monthly). */
export type WeekSummary = {
  weekStart: string;
  weekEnd: string;
  /** Office days worked in the whole week (both months), full / half, and their sum. */
  officeFull: number;
  officeHalf: number;
  office: number;
  /** Days worked only from home — not quota days. */
  wfhOnly: number;
  /** The weekly days the employee is meant to come (their days a week). */
  expected: number;
  /** The week is over. */
  done: boolean;
  /** Worth a look before paying: fewer office days than the weekly days ("low"), or an
   *  office day on every Mon–Sat ("high"). Only judged when the week is over, and only
   *  in the month the week ends in. */
  flag: "low" | "high" | null;
};

export type MonthlyBreakdown = {
  presentDays: number;
  halfDays: number;
  holidayDays: number;
  /** Paid leave in days — fractional when half-day leave is involved. */
  paidLeaveDays: number;
  /** Of `paidLeaveDays`, the days covered by a balance day used on purpose
   *  (compensation credit). Not an extra count: already inside `paidLeaveDays`. */
  balanceDays: number;
  /** Unpaid leave in days — fractional when half-day leave is involved. */
  unpaidLeaveDays: number;
  /** Absent in days. Fractional for half a day of leave with the rest unworked, and
   *  for a part-timer's weekly-quota shortfall. */
  absentDays: number;
  /** Extra days that made up an earlier missed day (paid, 1 each). Before the rule
   *  date: a part-timer's days beyond the weekly quota (paid as before). */
  compensationDays: number;
  /** Days worked in advance (a worked weekly off, a flagged day, or — under the rule —
   *  a part-timer's day over quota with nothing to make up): counted in `presentDays`.
   *  Not a working day the employee owed, so left out of `creditedWorkingDays`. */
  advanceDays: number;
  /** Of `advanceDays`, the ones banked as a balance day and NOT paid (credit 0) —
   *  every advance day from the rule date on. Present but not payable. */
  bankedDays: number;
  /** A part-timer's days worked only from home (under the rule): shown as worked,
   *  but they belong to the weekly WFH-hours target, not the in-office day quota —
   *  so they are not paid as days (credit 0). Whole and half days, counted per day. */
  wfhOnlyDays: number;
  /** A part-timer's half days beyond the week's quota (under the rule): worked, not
   *  paid (credit 0) — the quota is what is paid. */
  overQuotaHalfDays: number;
  /** Worked time shown in present/half-days but not paid, in days: banked days (1
   *  each) + WFH-only part-timer days (1 or ½) + over-quota half days (½). So
   *  payableDays = present + half×0.5 + paid leave + holiday + compensation − this. */
  unpaidWorkDays: number;
  /** Expected working days considered so far (present+half+holiday+paidLeave+unpaidLeave+absent). */
  workingDaysElapsed: number;
  /** Days that count toward pay: (present − banked) + half×0.5 + paid leave +
   *  holiday + compensation — the exact sum of `days[].credit` and the numerator of
   *  lib/payroll/calc.ts's earned-pay formula. */
  payableDays: number;
  /** Days actually worked: present + half×0.5 + compensation (a day worked on the
   *  weekly off or flagged as compensation is still a day at work). Leave and
   *  holidays are paid but not worked, so they are not in here. */
  daysWorked: number;
  /** Weekly offs taken in the walked span (days[] entries with status
   *  `weekly_off`). A flexible-schedule employee has no fixed off, so 0. */
  weeklyOffDays: number;
  /** Days credited against `workingDaysElapsed` for the performance score:
   *  present + half×0.5 + holiday + paid leave, with a part-timer's weeks capped at
   *  their quota (extra days are compensation, not a better attendance score). */
  creditedWorkingDays: number;
  /** The actual dates behind absentDays — fixed-schedule employees only (see
   *  isFlexible below); a flexible employee's absences are a weekly-aggregate
   *  shortfall with no single date to anchor to, so this stays empty for
   *  them. Added 2026-09-18 so lib/attendance/compensation-credits.ts can
   *  redeem a credit against a specific absent day, not just a count. Only whole
   *  absent days are listed (a half-absent day is not redeemable). */
  absentDates: Date[];
  /** Extra days on/after the rule date (for the ledger: lib/attendance/extra-days.ts). */
  extraDays: ExtraDay[];
  /** Missed days that an extra day could make up — whole absences, whole unpaid
   *  days, a part-timer's whole shortfall days (dated the end of their week). */
  missedUnits: MissedUnit[];
  /** This month's missed days that a later extra day made up, and on which day —
   *  possibly in a later month. */
  madeUp: { missed: MissedUnit; on: string; amount?: number }[];
  /** A part-timer's weeks touching this month (Monday to Sunday), for the weekly
   *  check (monthly quota months only). Empty otherwise. */
  weeks: WeekSummary[];
  /** A part-timer's days owed this month under the monthly quota (null otherwise). */
  owedDays: number | null;
  /** Approved paid leave this month that the quota didn't need (monthly quota): not
   *  paid, and given back to the leave balance. */
  paidLeaveUnused: number;
  /** One entry per day that was actually evaluated (joining date..today), in date
   *  order — the same walk that produced the counts above, so a calendar built
   *  from it can never disagree with the tiles. Days not listed (before the
   *  employee existed, or still in the future) were not evaluated. */
  days: ClassifiedDay[];
};

/** What one evaluated day turned out to be. `no_record` is the flexible-schedule
 *  (part-time / intern) "didn't work this day" — their shortfall is a weekly
 *  aggregate, so no single date is an absence. `live` and `today` are only ever
 *  today: still being worked / not started — not counted anywhere yet. */
export type DayStatus =
  | "present"
  | "half_day"
  | "compensation"
  | "absent"
  | "paid_leave"
  | "unpaid_leave"
  | "holiday"
  | "weekly_off"
  | "no_record"
  | "live"
  | "today";

export type ClassifiedDay = {
  date: string;
  status: DayStatus;
  /** Why a day has the status it has, where that isn't obvious:
   *  - auto_off: a no-show day turned into the week's weekly off automatically;
   *  - provisional_off: the same, but this week's default off day is still to
   *    come, so it can flip back to absent;
   *  - declared_unpaid: the employee switched an automatic weekly off to unpaid;
   *  - advance: a day worked in advance (weekly off / flagged) — shown as present,
   *    and it earned a balance day;
   *  - balance: an absent / unpaid-leave day covered by a balance day used on purpose;
   *  - wfh_hours: a part-timer's day worked only from home — it counts toward the
   *    weekly WFH hours, not the in-office day quota, so it is not paid as a day;
   *  - over_quota: a part-timer's half day beyond the week's quota — not paid;
   *  - not_needed: a part-timer's leave the month's quota didn't need (monthly quota):
   *    paid leave goes back to the balance, unpaid leave costs nothing. */
  note?:
    | "auto_off"
    | "provisional_off"
    | "declared_unpaid"
    | "advance"
    | "balance"
    | "wfh_hours"
    | "over_quota"
    | "not_needed";
  /** What the day is worth toward pay, in days (0, 0.5, 1). */
  credit: number;
  /** Leave applied to this day, in days — present only when > 0. A half-day leave
   *  on a half-day worked is {leavePaid: 0.5}: 0.5 worked + 0.5 leave = a full day. */
  leavePaid?: number;
  leaveUnpaid?: number;
  /** The part of the day counted absent, when it is only part of it (a half-day
   *  leave and nothing else that day). Absent on a plain `absent` day (= 1). */
  absentPart?: number;
  /** An advance day banked as a balance day (not paid; see extra-days.ts). */
  banked?: true;
  /** How much of the day was banked when it is not the whole day worked (0.5). */
  bankedAmount?: number;
  /** A banked day's last day of use, and the day it was spent on, if it was. */
  bankExpires?: string;
  bankUsedFor?: string;
  /** A compensation day: the missed day it made up (`weekStart` for a part-timer's
   *  quota shortfall, which has no single date). */
  madeUpFor?: { date: string; kind: MissedUnit["kind"]; weekStart?: string; month?: string };
  /** An absent / unpaid day that a later extra day made up (still unpaid here — the
   *  pay is on the day that made it up). */
  madeUpOn?: string;
  /** A balance-covered day: when the balance day used on it was earned. */
  balanceEarned?: string;
};

type DayAttendance = {
  hasClockIn: boolean;
  isHalfDay: boolean;
  isCompensation: boolean;
  /** null while the day is still open (clocked in, not yet out). */
  totalHours: number | null;
  /** Clocked in with no clock-out yet. Only decides what *today* is (see `live`);
   *  a past day that was never closed is judged by its hours as before. */
  isOpen?: boolean;
  /** Where it was worked — decides what an extra day can make up. Default office. */
  location?: Place;
};

type MonthLookups = {
  attendanceByDate: Map<string, DayAttendance>;
  /** Leave per date, in days by kind. Preferred; built from the approved leave rows
   *  (half-day rows count 0.5) by the loaders below. */
  leaveByDate?: Map<string, LeaveDayEntry>;
  /** Legacy shape: a date -> whole-day leave type. Used only when `leaveByDate`
   *  is not given. */
  leaveTypeByDate?: Map<string, RequestType>;
  holidayDates: Set<string>;
  /** 0=Sunday..6=Saturday — the employee's effective default off day. */
  defaultOffDay: number;
  /** weekStart date-key -> off-date-key, for weeks with an active WeeklyOffMove. */
  movedOffDateByWeek: Map<string, string>;
  employmentType?: EmploymentType;
  requiredDaysPerWeek?: number | null;
  /** Nothing before this date is the employee's responsibility. */
  dateOfJoining?: Date | null;
  /** Days the employee switched from a weekly off to unpaid leave themselves. */
  declaredUnpaidDates?: Set<string>;
  /** Days covered by a balance day used on purpose. */
  balanceDates?: Set<string>;
  /** Covered date -> the date the balance day used on it was earned (for the note). */
  balanceEarnedFor?: Map<string, string>;
  /** Days an approved work-from-home request covers: a missed one is a WFH day. */
  wfhRequestDates?: Set<string>;
  /** Extra days on/after this date follow the make-up rule (extra-days.ts). Unset:
   *  the pre-rule treatment throughout. */
  extraRuleFrom?: string;
  /** What each extra day did, from matchExtraDays. Unset with a rule date: every
   *  extra day is treated as banked (the ledger's own first pass). */
  extraVerdicts?: Map<string, ExtraVerdict>;
  /** Missed unit id -> the extra day that made it up. */
  madeUpOn?: Map<string, string>;
  /** Missed unit id -> how much of it was made up (when not the whole unit). */
  madeUpAmount?: Map<string, number>;
  /** Missed unit ids a banked day covered automatically (their day is in balanceDates). */
  coveredUnits?: Set<string>;
  /** Day -> how much the ledger's automatic covers put on it, and the day that earned
   *  it (0.5 or 1) — the monthly part-timer walk tells these from balance days used
   *  through a request (also in balanceDates). */
  coverAmountByDate?: Map<string, { amount: number; by: string }>;
  /** Overrides "today" — for tests; defaults to the real date. */
  today?: Date;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The `madeUpFor` a day carries for the missed unit it made up. */
function madeUpForOf(m: MissedUnit): NonNullable<ClassifiedDay["madeUpFor"]> {
  return {
    date: m.date,
    kind: m.kind,
    ...(m.weekStart ? { weekStart: m.weekStart } : {}),
    ...(m.month ? { month: m.month } : {}),
  };
}

/** Rounds to the nearest half day (sums of halves drift in floating point). */
const half = (n: number) => Math.round(n * 2) / 2;

/** First day of the month the employee is *expected* at work: day 1, or the
 *  joining day for someone who joined mid-month. Days before an employee existed
 *  are not absences — they used to be counted as such, deducting a full month's
 *  pay from a new hire's first payslip and sinking their attendance score to
 *  near zero.
 *
 *  This only decides what is owed, never what is ignored: an approved record on
 *  an earlier day is real work and still counts (see classifyMonth). Skipping it
 *  made a month's tiles total fewer days than the records listed right under
 *  them (2026-09-30: joining date 5 Aug, approved records from 1 Aug). */
function firstElapsedDay(month: number, year: number, dateOfJoining?: Date | null): number {
  if (!dateOfJoining) return 1;
  const joinMonthStart = Date.UTC(dateOfJoining.getUTCFullYear(), dateOfJoining.getUTCMonth(), 1);
  const monthStart = Date.UTC(year, month - 1, 1);
  if (joinMonthStart < monthStart) return 1; // joined before this month
  if (joinMonthStart > monthStart) return Infinity; // joined after it: no days count
  return dateOfJoining.getUTCDate();
}

/** Last day of the month to actually walk: the whole month if it's fully in
 *  the past, 0 days if fully in the future, else up through today (UTC). */
function lastElapsedDay(month: number, year: number, now: Date = new Date()): number {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = Date.UTC(year, month - 1, 1);
  const monthEndExclusive = Date.UTC(year, month, 1);
  if (todayUTC >= monthEndExclusive) return lastDay; // month fully in the past
  if (todayUTC < monthStart) return 0; // month fully in the future
  return new Date(todayUTC).getUTCDate();
}

/** What a day's work is worth on its own: 1 for a full day, 0.5 for a short one,
 *  0 for no record or a zero-hour one. */
function workedCredit(attendance: DayAttendance | undefined): number {
  return attendance?.hasClockIn ? dayCredit(attendance.totalHours, attendance.isHalfDay) : 0;
}

/** Leave fills only the part of the day that was not worked: a whole-day leave on
 *  a day worked half is half a day of leave, and a day worked in full needs none.
 *  Paid is applied before unpaid. This is what stops a day being counted as more
 *  than one day however many things touch it. */
function applyLeave(
  worked: number,
  leave: LeaveDayEntry | undefined,
  /** A balance day was used on this date. */
  balance = false,
): { paid: number; unpaid: number; balance: number } {
  const room = Math.max(0, 1 - worked);
  const paid = Math.min(leave?.paid ?? 0, room);
  // A balance day covers a whole day of nothing: not a day already worked at all or
  // already part-covered by paid leave. It takes the room before unpaid leave does
  // (using one on an unpaid-leave day is the point), so the day ends up paid.
  const bal = balance && worked === 0 && paid === 0 ? room : 0;
  const unpaid = Math.min(leave?.unpaid ?? 0, room - paid - bal);
  return { paid, unpaid, balance: bal };
}

export function classifyMonth(month: number, year: number, lookups: MonthLookups): MonthlyBreakdown {
  const result: MonthlyBreakdown = {
    presentDays: 0,
    halfDays: 0,
    holidayDays: 0,
    paidLeaveDays: 0,
    balanceDays: 0,
    unpaidLeaveDays: 0,
    absentDays: 0,
    compensationDays: 0,
    advanceDays: 0,
    bankedDays: 0,
    wfhOnlyDays: 0,
    overQuotaHalfDays: 0,
    unpaidWorkDays: 0,
    workingDaysElapsed: 0,
    payableDays: 0,
    daysWorked: 0,
    weeklyOffDays: 0,
    creditedWorkingDays: 0,
    absentDates: [],
    extraDays: [],
    missedUnits: [],
    madeUp: [],
    weeks: [],
    owedDays: null,
    paidLeaveUnused: 0,
    days: [],
  };

  const now = lookups.today ?? new Date();
  const through = lastElapsedDay(month, year, now);
  const from = firstElapsedDay(month, year, lookups.dateOfJoining);
  if (through === 0) return result;
  const todayKey = dateKey(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
  const declaredUnpaid = lookups.declaredUnpaidDates ?? new Set<string>();
  const balanceDates = lookups.balanceDates ?? new Set<string>();
  const wfhDates = lookups.wfhRequestDates ?? new Set<string>();
  const madeUpOn = lookups.madeUpOn ?? new Map<string, string>();
  const ruleFrom = lookups.extraRuleFrom ?? null;
  const placeOwed = (key: string): Place => (wfhDates.has(key) ? "wfh" : "office");

  /** Records a missed day an extra day could make up, with the day that did, if any. */
  const addMissed = (unit: MissedUnit): string | undefined => {
    result.missedUnits.push(unit);
    const on = madeUpOn.get(unit.id);
    if (on) result.madeUp.push({ missed: unit, on, amount: lookups.madeUpAmount?.get(unit.id) ?? unit.size ?? 1 });
    return on;
  };

  /** An extra day -> its entry, counted. Before the rule date it keeps the treatment
   *  it was paid under: a worked weekly off / flagged day is a paid present day
   *  (`legacy: "present"`), a part-timer's day over quota a paid compensation day. */
  const extraEntry = (
    key: string,
    attendance: DayAttendance | undefined,
    legacy: "present" | "compensation",
  ): ClassifiedDay => {
    if (ruleFrom === null || key < ruleFrom) {
      // Paid as a day back then; the ledger still uses it to settle that period's
      // missed days (extra-days.ts), so it is listed — it banks nothing.
      if (ruleFrom !== null) result.extraDays.push({ date: key, location: attendance?.location ?? "office", legacy: true });
      if (legacy === "compensation") {
        result.compensationDays += 1;
        return { date: key, status: "compensation", credit: 1 };
      }
      result.presentDays += 1;
      result.advanceDays += 1;
      return { date: key, status: "present", note: "advance", credit: 1 };
    }
    result.extraDays.push({ date: key, location: attendance?.location ?? "office" });
    const verdict = lookups.extraVerdicts?.get(key);
    if (verdict?.kind === "compensation") {
      result.compensationDays += 1;
      return { date: key, status: "compensation", credit: 1, madeUpFor: madeUpForOf(verdict.missed) };
    }
    // Banked — or, rarely, half made up and half banked (the matcher works in halves).
    const comp = verdict?.kind === "banked" ? verdict.compensated : 0;
    const banked = 1 - comp;
    result.presentDays += 1;
    result.advanceDays += 1;
    result.bankedDays += banked;
    result.unpaidWorkDays += banked;
    return {
      date: key,
      status: "present",
      note: "advance",
      credit: comp,
      banked: true,
      ...(banked < 1 ? { bankedAmount: banked } : {}),
      ...(verdict?.kind === "banked"
        ? {
            bankExpires: verdict.expires,
            ...(verdict.usedFor ? { bankUsedFor: verdict.usedFor } : {}),
            ...(verdict.missed ? { madeUpFor: madeUpForOf(verdict.missed) } : {}),
          }
        : {}),
    };
  };

  const leaveFor = (key: string): LeaveDayEntry | undefined => {
    const entry = lookups.leaveByDate?.get(key);
    if (entry) return entry;
    const legacy = lookups.leaveTypeByDate?.get(key);
    if (!legacy) return undefined;
    return isPaidLeaveType(legacy) ? { paid: 1, unpaid: 0 } : { paid: 0, unpaid: 1 };
  };
  const hasLeave = (key: string) => {
    // A balance day used on the date explains it exactly as approved leave does.
    if (balanceDates.has(key)) return true;
    const e = leaveFor(key);
    return !!e && e.paid + e.unpaid > 0;
  };

  // This week's weekly off, resolved once per week and reused (see
  // lib/attendance/weekly-off.ts for the rule). The lookups carry whole weeks,
  // including the days of a boundary week that fall in the neighbouring month,
  // so a month and its neighbour always agree on which day was the off.
  const weekOffCache = new Map<string, WeekOff>();
  const weekOffFor = (date: Date): WeekOff => {
    const weekStart = weekStartOf(date);
    const wKey = dateKey(weekStart);
    const cached = weekOffCache.get(wKey);
    if (cached) return cached;
    const workedDates = new Set<string>();
    const leaveDates = new Set<string>();
    for (let n = 0; n < 7; n++) {
      const k = dateKey(addDays(weekStart, n));
      if (lookups.attendanceByDate.get(k)?.hasClockIn) workedDates.add(k);
      if (hasLeave(k)) leaveDates.add(k);
    }
    const resolved = resolveWeekOff({
      weekStart,
      defaultOffDay: lookups.defaultOffDay,
      explicitOffDate: lookups.movedOffDateByWeek.get(wKey) ?? null,
      workedDates,
      holidayDates: lookups.holidayDates,
      leaveDates,
      declaredUnpaidDates: declaredUnpaid,
      todayKey,
      joinKey: lookups.dateOfJoining ? dateKey(lookups.dateOfJoining) : null,
    });
    weekOffCache.set(wKey, resolved);
    return resolved;
  };

  const isFlexible =
    lookups.employmentType !== "fulltime" &&
    lookups.requiredDaysPerWeek != null &&
    lookups.requiredDaysPerWeek > 0 &&
    lookups.requiredDaysPerWeek < 7;

  const isLiveDay = (key: string, attendance: DayAttendance | undefined) =>
    key === todayKey && !!attendance?.hasClockIn && !!attendance.isOpen;

  if (!isFlexible) {
    // Standard full-time (or fixed schedule) day-by-day classification
    for (let day = 1; day <= through; day++) {
      const date = new Date(Date.UTC(year, month - 1, day));
      const key = dateKey(date);
      const attendance = lookups.attendanceByDate.get(key);

      // Before the joining date nothing is owed, but a day that was actually
      // worked (an approved record exists) is still attendance.
      if (day < from && !attendance?.hasClockIn) continue;

      const live = isLiveDay(key, attendance);
      const weekOff = weekOffFor(date);
      if (weekOff.date === key) {
        // The week's off (claimed, automatic, or the default day): skipped
        // unless the employee actually clocked in (approved), which makes it a
        // compensation day. An automatic off is a no-show by construction, so
        // it can never be a comp day.
        if (attendance?.hasClockIn) {
          if (live) {
            result.days.push({ date: key, status: "live", credit: 0 });
          } else {
            result.days.push(extraEntry(key, attendance, "present"));
          }
        } else {
          result.days.push({
            date: key,
            status: "weekly_off",
            credit: 0,
            ...(weekOff.kind === "auto" ? { note: weekOff.provisional ? "provisional_off" : "auto_off" } : {}),
          } as ClassifiedDay);
        }
        continue;
      }

      // Still being worked today: counted once the session closes, not before.
      if (live && !lookups.holidayDates.has(key)) {
        result.workingDaysElapsed += 1;
        result.days.push({ date: key, status: "live", credit: 0 });
        continue;
      }

      if (attendance?.isCompensation) {
        // Manually flagged compensation day — same treatment as an off-day
        // advance day: an extra day, not counted as a regular working day.
        result.days.push(extraEntry(key, attendance, "present"));
        continue;
      }

      result.workingDaysElapsed += 1;

      if (lookups.holidayDates.has(key)) {
        result.holidayDays += 1;
        result.days.push({ date: key, status: "holiday", credit: 1 });
        continue;
      }

      const worked = workedCredit(attendance);
      const declared = declaredUnpaid.has(key);
      // A day the employee switched from an automatic weekly off to unpaid is an
      // unpaid day like any other — unless real leave already covers it.
      const leave = leaveFor(key) ?? (declared ? { paid: 0, unpaid: 1 } : undefined);
      const { paid: paidLeave, unpaid, balance: bal } = applyLeave(worked, leave, balanceDates.has(key));
      const paid = paidLeave + bal;
      // Only a day with nothing worked can be absent; a short day is a half-day,
      // not "half absent".
      let absent = worked === 0 ? 1 - paid - unpaid : 0;
      // Today isn't over: what would be absent is still to be earned.
      const pendingToday = key === todayKey && absent > 0;
      if (pendingToday) absent = 0;

      result.paidLeaveDays += paid;
      result.balanceDays += bal;
      result.unpaidLeaveDays += unpaid;
      result.absentDays += absent;
      const leaveFields = {
        ...(paid > 0 ? { leavePaid: paid } : {}),
        ...(unpaid > 0 ? { leaveUnpaid: unpaid } : {}),
      };

      if (worked === 1) {
        result.presentDays += 1;
        result.days.push({ date: key, status: "present", credit: 1 + paid, ...leaveFields });
      } else if (worked === 0.5) {
        result.halfDays += 1;
        result.days.push({ date: key, status: "half_day", credit: 0.5 + paid, ...leaveFields });
      } else if (paid > 0) {
        const earned = bal > 0 ? lookups.balanceEarnedFor?.get(key) : undefined;
        result.days.push({
          date: key,
          status: "paid_leave",
          credit: paid,
          ...leaveFields,
          ...(absent > 0 ? { absentPart: absent } : {}),
          ...(bal > 0 ? { note: "balance" as const } : {}),
          ...(earned ? { balanceEarned: earned } : {}),
        });
      } else if (unpaid > 0) {
        // A whole unpaid day (nothing else on it) can be made up by a later extra day.
        const on =
          unpaid === 1 && !pendingToday
            ? addMissed({ id: key, date: key, kind: "unpaid_leave", location: placeOwed(key) })
            : undefined;
        result.days.push({
          date: key,
          status: "unpaid_leave",
          credit: 0,
          ...leaveFields,
          ...(absent > 0 ? { absentPart: absent } : {}),
          ...(declared && !leaveFor(key) ? { note: "declared_unpaid" as const } : {}),
          ...(on ? { madeUpOn: on } : {}),
        });
      } else if (pendingToday) {
        result.days.push({ date: key, status: "today", credit: 0 });
      } else {
        // Nothing worked and nothing covering it: a whole absent day. (A day that is
        // only half absent — half-day leave, nothing worked — is counted in
        // absentDays through its leave branch above and is deliberately not listed
        // in absentDates: a compensation credit covers whole days.)
        result.absentDates.push(date);
        const on = addMissed({ id: key, date: key, kind: "absence", location: placeOwed(key) });
        result.days.push({ date: key, status: "absent", credit: 0, ...(on ? { madeUpOn: on } : {}) });
      }
    }

    return finish(result, isFlexible, 0);
  }

  // Flexible schedule (part-time / flexible intern). From the rule month on the quota
  // is MONTHLY (see the header); before it, days are grouped by week as they were paid.
  const required = lookups.requiredDaysPerWeek!;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const monthPrefix = `${year}-${String(month).padStart(2, "0")}`;
  const joinKey = lookups.dateOfJoining ? dateKey(lookups.dateOfJoining) : null;
  const isMonSat = (key: string) => new Date(`${key}T00:00:00.000Z`).getUTCDay() !== 0;

  /** A part-timer's month under the monthly quota (owner, 2026-11-01). */
  const classifyQuotaMonth = (): MonthlyBreakdown => {
    const monthEndKey = `${monthPrefix}-${String(daysInMonth).padStart(2, "0")}`;
    const keys = Array.from({ length: daysInMonth }, (_, i) => `${monthPrefix}-${String(i + 1).padStart(2, "0")}`);
    // Owed: their share (days a week / 6) of the month's Mon–Sat days that aren't
    // holidays, from the joining date. 3 days a week owes half: October 27 -> 13.5.
    const owedKeys = keys.filter((k) => (!joinKey || k >= joinKey) && isMonSat(k) && !lookups.holidayDates.has(k));
    const owed = half((owedKeys.length * required) / 6);
    result.owedDays = owed;
    const monthDone = monthEndKey < todayKey;
    const covers = lookups.coverAmountByDate ?? new Map<string, { amount: number; by: string }>();

    type Entry = {
      key: string;
      attendance: DayAttendance | undefined;
      kind: "present" | "half" | "wfh" | "paid" | "unpaid" | "holiday" | "none" | "live";
      worked: number;
      paid: number;
      unpaid: number;
      bal: number;
    };
    const entries: Entry[] = [];
    for (const key of keys) {
      if (key > todayKey) break; // still to come
      const attendance = lookups.attendanceByDate.get(key);
      if (joinKey && key < joinKey && !attendance?.hasClockIn) continue; // not owed yet
      const base = { key, attendance, worked: 0, paid: 0, unpaid: 0, bal: 0 };
      if (isLiveDay(key, attendance)) {
        entries.push({ ...base, kind: "live" });
        continue;
      }
      const worked = workedCredit(attendance);
      // A holiday nobody worked is just a closed day; one worked is a worked day.
      if (lookups.holidayDates.has(key) && worked === 0) {
        entries.push({ ...base, kind: "holiday" });
        continue;
      }
      // A balance day used through a request counts like any paid day; the ledger's
      // automatic covers are put on below (they depend on the shortfall worked out here).
      const { paid, unpaid, balance: bal } = applyLeave(worked, leaveFor(key), balanceDates.has(key) && !covers.has(key));
      const kind: Entry["kind"] =
        worked > 0 && attendance?.location === "wfh"
          ? "wfh"
          : worked === 1
            ? "present"
            : worked === 0.5
              ? "half"
              : paid + bal > 0
                ? "paid"
                : unpaid > 0
                  ? "unpaid"
                  : "none";
      entries.push({ ...base, kind, worked, paid, unpaid, bal });
    }

    const sum = (f: (e: Entry) => number) => half(entries.reduce((a, e) => a + f(e), 0));
    const isOffice = (e: Entry) => e.kind === "present" || e.kind === "half";
    const office = sum((e) => (isOffice(e) ? e.worked : 0));
    const requested = sum((e) => e.bal);

    // Paid leave fills only what the office days leave short, earliest leave first;
    // the rest is not paid and goes back to the leave balance.
    const leaveUse = Math.min(sum((e) => e.paid), Math.max(0, half(owed - office - requested)));
    const leaveUsed = new Map<string, number>();
    let leaveLeft = leaveUse;
    for (const e of entries) {
      if (e.paid <= 0 || leaveLeft <= 0) continue;
      const u = Math.min(e.paid, leaveLeft);
      leaveUsed.set(e.key, u);
      leaveLeft = half(leaveLeft - u);
    }

    // Short, once the month is over. Unpaid leave explains that much of it (earliest
    // first) and is a missed day a later extra day can make up; the rest is absence —
    // covered by earlier balance automatically, else made up later.
    const shortfall = monthDone ? Math.max(0, half(owed - office - requested - leaveUse)) : 0;
    const unpaidCost = Math.min(shortfall, sum((e) => e.unpaid));
    const absence = half(shortfall - unpaidCost);

    // Over the quota: the latest whole office days are the extra ones; a .5 left over
    // takes the latest half day (else half of the latest whole day left). Known as soon
    // as the month's quota is passed.
    const extraSize = new Map<string, number>();
    let over = Math.max(0, half(office + requested - owed));
    for (let i = entries.length - 1; i >= 0 && over >= 1; i--) {
      if (entries[i]!.kind !== "present") continue;
      extraSize.set(entries[i]!.key, 1);
      over = half(over - 1);
    }
    for (const kind of ["half", "present"] as const) {
      for (let i = entries.length - 1; i >= 0 && over > 0; i--) {
        const e = entries[i]!;
        if (e.kind !== kind || extraSize.has(e.key)) continue;
        extraSize.set(e.key, 0.5);
        over = half(over - 0.5);
      }
    }

    // Missed units — the same ids and dates in the ledger's pass and the final one (the
    // automatic covers don't change them; they are only put on afterwards).
    const unpaidMadeUpOn = new Map<string, string>();
    let unpaidLeft = unpaidCost;
    for (const e of entries) {
      if (e.unpaid <= 0 || unpaidLeft <= 0) continue;
      const size = Math.min(e.unpaid, unpaidLeft);
      unpaidLeft = half(unpaidLeft - size);
      const on = addMissed({ id: e.key, date: e.key, kind: "unpaid_leave", location: placeOwed(e.key), size });
      if (on) unpaidMadeUpOn.set(e.key, on);
    }
    const costs = new Set<string>();
    {
      let left = unpaidCost;
      for (const e of entries) {
        if (e.unpaid <= 0 || left <= 0) continue;
        costs.add(e.key);
        left = half(left - Math.min(e.unpaid, left));
      }
    }
    // A cover goes on one of the month's not-worked Mon–Sat days (latest first), so the
    // pay lands on a real calendar day.
    const coverDays = entries
      .filter((e) => e.kind === "none" && isMonSat(e.key) && e.key < todayKey)
      .map((e) => e.key)
      .reverse();
    for (let i = 0, left = absence; left > 0; i++) {
      const size = Math.min(1, left);
      left = half(left - size);
      const coverDate = coverDays[i];
      addMissed({
        id: `${monthPrefix}#${i + 1}`,
        date: monthEndKey,
        kind: "shortfall",
        location: "office",
        size,
        month: monthPrefix,
        ...(coverDate ? { coverDate } : {}),
      });
    }

    let covered = 0;
    for (const e of entries) {
      const { key, attendance } = e;
      const used = leaveUsed.get(key) ?? 0;
      result.paidLeaveUnused += half(e.paid - used);
      result.paidLeaveDays += used + e.bal;
      result.balanceDays += e.bal;
      const leaveFields = {
        ...(used > 0 ? { leavePaid: used } : {}),
        ...(e.unpaid > 0 ? { leaveUnpaid: e.unpaid } : {}),
      };
      switch (e.kind) {
        case "live":
          result.days.push({ date: key, status: "live", credit: 0 });
          break;
        case "holiday":
          // Shown, but neither owed nor paid for a part-timer — not in holidayDays.
          result.days.push({ date: key, status: "holiday", credit: 0 });
          break;
        case "present":
        case "half": {
          const status = e.kind === "present" ? "present" : "half_day";
          const s = extraSize.get(key) ?? 0;
          if (s === 0) {
            if (e.kind === "present") result.presentDays += 1;
            else result.halfDays += 1;
            result.days.push({ date: key, status, credit: e.worked + used, ...leaveFields });
            break;
          }
          result.extraDays.push({ date: key, location: attendance?.location ?? "office", size: s });
          const v = lookups.extraVerdicts?.get(key);
          const comp = Math.min(s, v?.kind === "compensation" ? v.amount : v?.kind === "banked" ? v.compensated : 0);
          const banked = half(s - comp);
          const missed = v?.kind === "compensation" ? v.missed : v?.kind === "banked" ? v.missed : undefined;
          if (banked === 0 && comp === e.worked) {
            // The whole day made up an earlier missed day: paid here.
            result.compensationDays += e.worked;
            result.days.push({
              date: key,
              status: "compensation",
              credit: e.worked,
              ...(missed ? { madeUpFor: madeUpForOf(missed) } : {}),
            });
            break;
          }
          if (e.kind === "present") result.presentDays += 1;
          else result.halfDays += 1;
          if (banked > 0) {
            result.advanceDays += 1;
            result.bankedDays += banked;
            result.unpaidWorkDays += banked;
          }
          result.days.push({
            date: key,
            status,
            credit: half(e.worked - banked + used),
            ...leaveFields,
            ...(banked > 0 ? { note: "advance" as const, banked: true as const } : {}),
            ...(banked > 0 && banked < e.worked ? { bankedAmount: banked } : {}),
            ...(v?.kind === "banked" ? { bankExpires: v.expires, ...(v.usedFor ? { bankUsedFor: v.usedFor } : {}) } : {}),
            ...(missed && comp > 0 ? { madeUpFor: madeUpForOf(missed) } : {}),
          });
          break;
        }
        case "wfh":
          // Worked only from home: WFH hours, not a quota day.
          if (e.worked === 1) result.presentDays += 1;
          else result.halfDays += 1;
          result.wfhOnlyDays += 1;
          result.unpaidWorkDays += e.worked;
          result.days.push({
            date: key,
            status: e.worked === 1 ? "present" : "half_day",
            note: "wfh_hours",
            credit: used,
            ...leaveFields,
          });
          break;
        case "paid": {
          const earned = e.bal > 0 ? lookups.balanceEarnedFor?.get(key) : undefined;
          const credit = used + e.bal;
          result.days.push({
            date: key,
            status: credit > 0 || e.unpaid === 0 ? "paid_leave" : "unpaid_leave",
            credit,
            ...leaveFields,
            ...(e.bal > 0 ? { note: "balance" as const } : credit === 0 ? { note: "not_needed" as const } : {}),
            ...(earned ? { balanceEarned: earned } : {}),
          });
          break;
        }
        case "unpaid": {
          const on = unpaidMadeUpOn.get(key);
          result.days.push({
            date: key,
            status: "unpaid_leave",
            credit: 0,
            ...leaveFields,
            ...(costs.has(key) || !monthDone ? {} : { note: "not_needed" as const }),
            ...(on ? { madeUpOn: on } : {}),
          });
          break;
        }
        case "none": {
          const cover = covers.get(key);
          if (cover) {
            covered += cover.amount;
            result.paidLeaveDays += cover.amount;
            result.balanceDays += cover.amount;
            result.days.push({
              date: key,
              status: "paid_leave",
              credit: cover.amount,
              note: "balance",
              balanceEarned: cover.by,
            });
          } else {
            result.days.push({ date: key, status: key === todayKey ? "today" : "no_record", credit: 0 });
          }
          break;
        }
      }
    }

    result.paidLeaveUnused = half(result.paidLeaveUnused);
    result.unpaidLeaveDays = unpaidCost;
    result.absentDays = Math.max(0, half(absence - covered));
    const elapsedOwed = owedKeys.filter((k) => k <= todayKey).length;
    result.workingDaysElapsed = monthDone || owedKeys.length === 0 ? owed : half((owed * elapsedOwed) / owedKeys.length);
    const credited = Math.min(owed, half(office + leaveUse + requested + covered));

    // The weekly check (never pay): every Mon–Sun week touching the month, counted
    // whole; flagged in the month it ends in, once it is over.
    for (let ws = weekStartOf(new Date(`${monthPrefix}-01T00:00:00.000Z`)); dateKey(ws) <= monthEndKey; ws = addDays(ws, 7)) {
      const wKeys = Array.from({ length: 7 }, (_, n) => dateKey(addDays(ws, n)));
      const weekEnd = wKeys[6]!;
      let officeFull = 0;
      let officeHalf = 0;
      let wfhOnly = 0;
      for (const k of wKeys) {
        const a = lookups.attendanceByDate.get(k);
        if (k > todayKey || isLiveDay(k, a)) continue;
        const w = workedCredit(a);
        if (w === 0) continue;
        if (a?.location === "wfh") wfhOnly += 1;
        else if (w === 1) officeFull += 1;
        else officeHalf += 1;
      }
      const workable = wKeys.filter((k) => (!joinKey || k >= joinKey) && isMonSat(k) && !lookups.holidayDates.has(k)).length;
      const expected = Math.min(required, workable);
      const officeDays = officeFull + officeHalf * 0.5;
      const done = weekEnd < todayKey;
      const judged = done && weekEnd.startsWith(monthPrefix);
      result.weeks.push({
        weekStart: wKeys[0]!,
        weekEnd,
        officeFull,
        officeHalf,
        office: officeDays,
        wfhOnly,
        expected,
        done,
        flag: !judged ? null : officeDays < expected ? "low" : officeFull + officeHalf >= 6 ? "high" : null,
      });
    }

    return finish(result, true, credited);
  };

  if (ruleFrom !== null && `${monthPrefix}-01` >= ruleFrom) return classifyQuotaMonth();

  // Before the rule month: days grouped by week, each month's share of a week judged
  // on its own (how those months were paid).
  const weeksMap = new Map<string, { weekStart: Date; allDaysInMonth: Date[]; elapsedDays: Date[] }>();
  for (let day = 1; day <= daysInMonth; day++) {
    // Days before `from` are left out of the week, which pro-rates the joining
    // week's quota: a part-timer who joins on a Thursday owes that week a share,
    // not the full weekly target. A day they actually worked before joining is
    // kept, as in the fixed-schedule walk above.
    const date = new Date(Date.UTC(year, month - 1, day));
    if (day < from && !lookups.attendanceByDate.get(dateKey(date))?.hasClockIn) continue;
    const wStart = weekStartOf(date);
    const wKey = dateKey(wStart);
    let entry = weeksMap.get(wKey);
    if (!entry) {
      entry = { weekStart: wStart, allDaysInMonth: [], elapsedDays: [] };
      weeksMap.set(wKey, entry);
    }
    entry.allDaysInMonth.push(date);
    if (day <= through) {
      entry.elapsedDays.push(date);
    }
  }

  let creditedWorkingDays = 0;

  for (const week of weeksMap.values()) {
    if (week.elapsedDays.length === 0) continue;

    const daysInThisMonthChunk = week.allDaysInMonth.length;
    const targetForChunk =
      daysInThisMonthChunk >= 7 ? required : Math.max(1, Math.round((daysInThisMonthChunk / 7) * required));

    let weekPresent = 0;
    let weekHalf = 0;
    let weekPaidLeave = 0;
    let weekUnpaidLeave = 0;
    let weekHoliday = 0;
    const weekDays: ClassifiedDay[] = [];
    const wholeUnpaidDays: string[] = [];

    for (const date of week.elapsedDays) {
      const key = dateKey(date);
      const attendance = lookups.attendanceByDate.get(key);

      // Still being worked today: counted once the session closes.
      if (isLiveDay(key, attendance) && !lookups.holidayDates.has(key)) {
        weekDays.push({ date: key, status: "live", credit: 0 });
        continue;
      }

      if (attendance?.isCompensation) {
        // A flagged day is an extra day, shown as present like any day worked in
        // advance. It stays outside the weekly quota (as before).
        weekDays.push(extraEntry(key, attendance, "present"));
        continue;
      }

      if (lookups.holidayDates.has(key)) {
        weekHoliday += 1;
        weekDays.push({ date: key, status: "holiday", credit: 1 });
        continue;
      }

      const worked = workedCredit(attendance);
      const { paid, unpaid } = applyLeave(worked, leaveFor(key));
      weekPaidLeave += paid;
      weekUnpaidLeave += unpaid;
      const leaveFields = {
        ...(paid > 0 ? { leavePaid: paid } : {}),
        ...(unpaid > 0 ? { leaveUnpaid: unpaid } : {}),
      };

      if (worked === 1) {
        weekPresent += 1;
        weekDays.push({ date: key, status: "present", credit: 1 + paid, ...leaveFields });
      } else if (worked === 0.5) {
        weekHalf += 1;
        weekDays.push({ date: key, status: "half_day", credit: 0.5 + paid, ...leaveFields });
      } else if (paid > 0) {
        weekDays.push({ date: key, status: "paid_leave", credit: paid, ...leaveFields });
      } else if (unpaid > 0) {
        // A whole unpaid day is a missed day only if the week ends up short (below).
        if (unpaid === 1) wholeUnpaidDays.push(key);
        weekDays.push({ date: key, status: "unpaid_leave", credit: 0, ...leaveFields });
      } else {
        // Nothing worked, nothing covering it: a day that counts toward neither —
        // the week's quota shortfall picks it up below. (A zero-hour record lands
        // here too.)
        weekDays.push({ date: key, status: key === todayKey ? "today" : "no_record", credit: 0 });
      }
    }

    const creditedDays = weekPresent + weekHalf * 0.5 + weekPaidLeave + weekHoliday;

    result.halfDays += weekHalf;
    result.paidLeaveDays += weekPaidLeave;
    result.unpaidLeaveDays += weekUnpaidLeave;
    result.holidayDays += weekHoliday;
    creditedWorkingDays += Math.min(creditedDays, targetForChunk);

    // Shortfall days that an unpaid leave already explains are not also absences:
    // counting both showed one missed day twice (absent *and* unpaid leave). Pay is
    // unaffected — neither is paid.
    const absentShortfall = (shortfall: number) => shortfall - Math.min(shortfall, weekUnpaidLeave);

    if (creditedDays > targetForChunk) {
      // Over quota. Present and compensation are paid identically, so whole worked
      // days beyond the quota are relabelled compensation — the latest ones, as the
      // overflow has no single "extra" day. A half-day of overflow stays what it
      // was (a half-day); relabelling is capped at the full days there are, so
      // leave or half-days alone can never conjure a compensation day (that used to
      // double-count them). Present + compensation always equals the full days
      // worked, so nothing is added or lost.
      const extra = creditedDays - targetForChunk;
      let toRelabel = Math.min(Math.floor(extra), weekPresent);
      result.compensationDays += toRelabel;
      result.presentDays += weekPresent - toRelabel;
      result.workingDaysElapsed += targetForChunk;
      for (let i = weekDays.length - 1; i >= 0 && toRelabel > 0; i--) {
        // An advance day is outside the quota already — never relabel it.
        if (weekDays[i]!.status === "present" && weekDays[i]!.note !== "advance") {
          weekDays[i]!.status = "compensation";
          toRelabel -= 1;
          // A pre-rule extra day: paid back then, it settles that period's missed days.
          if (ruleFrom !== null) {
            const d = weekDays[i]!.date;
            result.extraDays.push({ date: d, location: lookups.attendanceByDate.get(d)?.location ?? "office", legacy: true });
          }
        }
      }
    } else {
      result.presentDays += weekPresent;

      const endOfWeek = addDays(week.weekStart, 6);
      const isWeekPast = endOfWeek.getTime() < todayUTC;

      if (isWeekPast) {
        const missing = Math.max(0, targetForChunk - creditedDays);
        const absent = absentShortfall(missing);
        result.absentDays += absent;
        result.workingDaysElapsed += targetForChunk;
        // Unpaid days only cost what the week is short: that many (the earliest) are
        // missed days a later extra day can make up — none in a week that met quota.
        for (const key of wholeUnpaidDays.slice(0, Math.floor(Math.min(missing, weekUnpaidLeave) + 1e-9))) {
          const on = addMissed({ id: key, date: key, kind: "unpaid_leave", location: placeOwed(key) });
          const day = weekDays.find((d) => d.date === key);
          if (on && day) day.madeUpOn = on;
        }
        // Whole days short in a week before the rule can still be made up by an extra
        // day after it (within 60 days) — dated the chunk's last day in this month.
        const lastKey = dateKey(week.allDaysInMonth[week.allDaysInMonth.length - 1]!);
        const wKey = dateKey(week.weekStart);
        for (let i = 0; i < Math.floor(absent + 1e-9); i++) {
          addMissed({
            id: `${wKey}@${monthPrefix}#${i + 1}`,
            date: lastKey,
            kind: "shortfall",
            location: "office",
            weekStart: wKey,
          });
        }
      } else {
        // The week is still running: only count a shortfall that can no longer be
        // made up. Today still can be, if it hasn't been worked yet.
        const todayOpen = weekDays.some((d) => d.date === todayKey && (d.status === "live" || d.status === "today"));
        let daysLeftInWeek = todayOpen ? 1 : 0;
        for (let i = 0; i < 7; i++) {
          const d = addDays(week.weekStart, i);
          if (d.getTime() > todayUTC) daysLeftInWeek += 1;
        }
        const maxPossible = creditedDays + daysLeftInWeek;
        if (maxPossible < targetForChunk) {
          const unavoidableAbsent = targetForChunk - maxPossible;
          result.absentDays += absentShortfall(unavoidableAbsent);
          result.workingDaysElapsed += creditedDays + unavoidableAbsent;
        } else {
          result.workingDaysElapsed += creditedDays;
        }
      }
    }

    result.days.push(...weekDays);
  }

  result.days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return finish(result, isFlexible, creditedWorkingDays);
}

/** Derives the two totals that are defined from the finished walk — and nothing
 *  else, so they cannot drift from the days they summarise. */
function finish(result: MonthlyBreakdown, isFlexible: boolean, flexibleCredited: number): MonthlyBreakdown {
  result.payableDays = result.days.reduce((sum, d) => sum + d.credit, 0);
  result.daysWorked = result.presentDays + result.halfDays * 0.5 + result.compensationDays;
  result.weeklyOffDays = result.days.filter((d) => d.status === "weekly_off").length;
  result.creditedWorkingDays = isFlexible
    ? flexibleCredited
    : result.presentDays - result.advanceDays + result.halfDays * 0.5 + result.holidayDays + result.paidLeaveDays;
  return result;
}

/** The whole ISO weeks a month touches: [Monday on/before day 1, Monday after the
 *  last day). Loaders read this wider span so a boundary week's weekly off is
 *  resolved from the whole week — classifyMonth still only walks the month. */
function weekSpan(periodStart: Date, periodEnd: Date): { start: Date; endExclusive: Date } {
  return {
    start: weekStartOf(periodStart),
    endExclusive: addDays(weekStartOf(new Date(periodEnd.getTime() - MS_PER_DAY)), 7),
  };
}

/** Expands an approved leave request's [dateFrom, dateTo] range into
 *  per-date entries within [rangeStart, rangeEndExclusive). */
function expandLeaveIntoRange(
  dateFrom: Date,
  dateTo: Date,
  type: RequestType,
  rangeStart: Date,
  rangeEndExclusive: Date,
  onDate: (key: string, type: RequestType) => void,
) {
  const start = dateFrom < rangeStart ? rangeStart : dateFrom;
  const end = dateTo < rangeEndExclusive ? dateTo : new Date(rangeEndExclusive.getTime() - MS_PER_DAY);
  for (let t = start.getTime(); t <= end.getTime(); t += MS_PER_DAY) {
    onDate(dateKey(new Date(t)), type);
  }
}

/** Folds approved leave rows into per-date leave entries (half-day rows count 0.5;
 *  several rows on one date add up, capped at one whole day). */
function buildLeaveByDate(
  leaves: { dateFrom: Date | null; dateTo: Date | null; type: RequestType; halfDay: boolean }[],
  span: { start: Date; endExclusive: Date },
): Map<string, LeaveDayEntry> {
  const map = new Map<string, LeaveDayEntry>();
  for (const l of leaves) {
    if (!l.dateFrom || !l.dateTo) continue;
    expandLeaveIntoRange(l.dateFrom, l.dateTo, l.type, span.start, span.endExclusive, (key, type) => {
      addLeaveToDay(map, key, type, l.halfDay);
    });
  }
  return map;
}

/**
 * Expected working days across the WHOLE month, not just the elapsed part —
 * every calendar day that is neither the employee's weekly off (honouring their
 * WeeklyOffMove for that week) nor a public holiday.
 *
 * Added 2026-08-10 for sales target pacing (lib/sales/pacing.ts), which needs a
 * full-month denominator to pro-rate a monthly target against. classifyMonth
 * deliberately stops at today, so it cannot supply this. Pure and exported so
 * the pacing maths is unit-testable.
 *
 * Approved leave is NOT subtracted here: future leave is knowable but future
 * absence is not, and mixing the two would make the denominator drift as the
 * month progresses. Leave is netted off the elapsed side instead
 * (expectedActivityDaysElapsed).
 */
export function expectedWorkingDaysInMonth(
  month: number,
  year: number,
  ctx: {
    holidayDates: Set<string>;
    defaultOffDay: number;
    movedOffDateByWeek: Map<string, string>;
  },
): number {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let count = 0;
  for (let day = 1; day <= lastDay; day++) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (isOffDay(date, ctx.defaultOffDay, ctx.movedOffDateByWeek)) continue;
    if (ctx.holidayDates.has(dateKey(date))) continue;
    count += 1;
  }
  return count;
}

/** Effective default off-day + this employee's active WeeklyOffMoves overlapping
 *  [rangeStart, rangeEnd) — the context isOffDay() and classification need.
 *  Exported (2026-09-06) for lib/attendance/compensation-credits.ts, which
 *  needs the same off-day/flexible-schedule context to decide whether a
 *  single attendance record qualifies for automatic credit issuance. */
export async function getOffDayContext(
  employeeId: string,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<{
  defaultOffDay: number;
  movedOffDateByWeek: Map<string, string>;
  employmentType?: EmploymentType;
  requiredDaysPerWeek?: number | null;
  dateOfJoining?: Date | null;
}> {
  const [employee, moves] = await Promise.all([
    prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        employmentType: true,
        requiredDaysPerWeek: true,
        defaultWeeklyOffDay: true,
        dateOfJoining: true,
        team: { select: { defaultWeeklyOffDay: true } },
      },
    }),
    prisma.weeklyOffMove.findMany({
      where: {
        employeeId,
        active: true,
        weekStart: { gte: addDays(weekStartOf(rangeStart), -7), lt: addDays(rangeEnd, 7) },
      },
      select: { weekStart: true, date: true },
    }),
  ]);

  return {
    defaultOffDay: resolveDefaultOffDay(employee?.defaultWeeklyOffDay, employee?.team?.defaultWeeklyOffDay),
    movedOffDateByWeek: buildMovedOffDateByWeek(moves),
    employmentType: employee?.employmentType,
    requiredDaysPerWeek: employee?.requiredDaysPerWeek,
    dateOfJoining: employee?.dateOfJoining,
  };
}

/** One approved attendance row -> what the walk needs to know about its day. */
function toDayAttendance(r: {
  clockInApproved: Date | null;
  clockInRaw: Date | null;
  clockOutApproved: Date | null;
  clockOutRaw: Date | null;
  isHalfDay: boolean;
  isCompensation: boolean;
  totalHours: unknown;
  workLocation?: string;
  sessions?: { clockIn: Date; clockOut: Date | null; workLocation: string }[];
}): DayAttendance {
  const hasClockIn = !!(r.clockInApproved ?? r.clockInRaw);
  const hours = r.totalHours === null ? null : Number(r.totalHours);
  return {
    location: dayPlace(hours, r.sessions ?? [], r.workLocation ?? "office"),
    // A device-synced day is never hand-approved (clockInApproved stays
    // null forever — see lib/integrations/teamoffice/reconcile.ts), so it was
    // silently landing in "absent" here even though approvalStatus is
    // already `approved`. Fall back to clockInRaw, same as
    // attendance/overview's live dashboard read already does.
    hasClockIn,
    isHalfDay: r.isHalfDay,
    isCompensation: r.isCompensation,
    totalHours: r.totalHours === null ? null : Number(r.totalHours),
    isOpen: hasClockIn && !(r.clockOutApproved ?? r.clockOutRaw),
  };
}

/** The record fields the walk reads (see toDayAttendance). */
const RECORD_SELECT = {
  employeeId: true,
  date: true,
  clockInApproved: true,
  clockInRaw: true,
  clockOutApproved: true,
  clockOutRaw: true,
  isHalfDay: true,
  isCompensation: true,
  totalHours: true,
  workLocation: true,
  sessions: { select: { clockIn: true, clockOut: true, workLocation: true } },
} as const;

const EMPLOYEE_SELECT = {
  id: true,
  fullName: true,
  employmentType: true,
  requiredDaysPerWeek: true,
  defaultWeeklyOffDay: true,
  dateOfJoining: true,
  team: { select: { id: true, name: true, defaultWeeklyOffDay: true } },
  department: { select: { id: true, name: true } },
} as const;

type LoadedEmployee = Prisma.EmployeeGetPayload<{ select: typeof EMPLOYEE_SELECT }>;

/** What to load for `month`: the month's whole weeks, widened back to 60 days before
 *  the rule date (every missed day an extra day after the rule could make up) and on
 *  to today (a later extra day may have made up a missed day of this month). */
function loadSpan(month: number, year: number, now: Date): { start: Date; endExclusive: Date } {
  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(year, month, 1));
  const ledgerStart = new Date(`${addDaysKey(EXTRA_DAY_RULE_FROM, -BALANCE_WINDOW_DAYS)}T00:00:00.000Z`);
  const tomorrow = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const start = periodEnd > ledgerStart && ledgerStart < periodStart ? ledgerStart : periodStart;
  const end = tomorrow > periodEnd ? tomorrow : periodEnd;
  return weekSpan(start, end);
}

/** Loads the walk's inputs for every employee matching `where`, over `span`. */
async function loadLookups(
  where: Prisma.EmployeeWhereInput,
  span: { start: Date; endExclusive: Date },
): Promise<{ employee: LoadedEmployee; lookups: MonthLookups }[]> {
  const employees = await prisma.employee.findMany({ where, select: EMPLOYEE_SELECT, orderBy: { fullName: "asc" } });
  if (employees.length === 0) return [];
  const ids = employees.map((e) => e.id);
  const inSpan = { gte: span.start, lt: span.endExclusive };

  const [records, requests, holidays, moves, declared, balanceRows] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: { employeeId: { in: ids }, approvalStatus: AttendanceApprovalStatus.approved, date: inSpan },
      select: RECORD_SELECT,
    }),
    prisma.request.findMany({
      where: {
        employeeId: { in: ids },
        type: { in: [...ALL_LEAVE_TYPES, RequestType.wfh] },
        status: RequestStatus.approved,
        dateFrom: { lt: span.endExclusive },
        dateTo: { gte: span.start },
      },
      select: { employeeId: true, dateFrom: true, dateTo: true, type: true, halfDay: true },
    }),
    prisma.holiday.findMany({ where: { date: inSpan }, select: { date: true } }),
    prisma.weeklyOffMove.findMany({
      where: {
        employeeId: { in: ids },
        active: true,
        weekStart: { gte: addDays(span.start, -7), lt: addDays(span.endExclusive, 7) },
      },
      select: { employeeId: true, weekStart: true, date: true },
    }),
    prisma.unpaidDayDeclaration.findMany({
      where: { employeeId: { in: ids }, date: inSpan },
      select: { employeeId: true, date: true },
    }),
    prisma.compensationCredit.findMany({
      where: { employeeId: { in: ids }, applied: true, consumedForDate: inSpan },
      select: { employeeId: true, earnedDate: true, consumedForDate: true },
    }),
  ]);

  const group = <T extends { employeeId: string }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const r of rows) {
      const list = map.get(r.employeeId);
      if (list) list.push(r);
      else map.set(r.employeeId, [r]);
    }
    return map;
  };
  const recordsBy = group(records);
  const requestsBy = group(requests);
  const movesBy = group(moves);
  const declaredBy = group(declared);
  const balanceBy = group(balanceRows);
  const holidayDates = new Set(holidays.map((h) => dateKey(h.date)));

  return employees.map((e) => {
    const attendanceByDate = new Map<string, DayAttendance>();
    for (const r of recordsBy.get(e.id) ?? []) attendanceByDate.set(dateKey(r.date), toDayAttendance(r));
    const own = requestsBy.get(e.id) ?? [];
    const wfhRequestDates = new Set<string>();
    for (const r of own) {
      if (r.type !== RequestType.wfh || !r.dateFrom || !r.dateTo) continue;
      expandLeaveIntoRange(r.dateFrom, r.dateTo, r.type, span.start, span.endExclusive, (key) => wfhRequestDates.add(key));
    }
    const balanceDates = new Set<string>();
    const balanceEarnedFor = new Map<string, string>();
    for (const b of balanceBy.get(e.id) ?? []) {
      if (!b.consumedForDate) continue;
      balanceDates.add(dateKey(b.consumedForDate));
      balanceEarnedFor.set(dateKey(b.consumedForDate), dateKey(b.earnedDate));
    }
    return {
      employee: e,
      lookups: {
        attendanceByDate,
        leaveByDate: buildLeaveByDate(
          own.filter((r) => r.type !== RequestType.wfh),
          span,
        ),
        holidayDates,
        defaultOffDay: resolveDefaultOffDay(e.defaultWeeklyOffDay, e.team?.defaultWeeklyOffDay),
        movedOffDateByWeek: buildMovedOffDateByWeek(movesBy.get(e.id) ?? []),
        employmentType: e.employmentType,
        requiredDaysPerWeek: e.requiredDaysPerWeek,
        dateOfJoining: e.dateOfJoining,
        declaredUnpaidDates: new Set((declaredBy.get(e.id) ?? []).map((d) => dateKey(d.date))),
        balanceDates,
        balanceEarnedFor,
        wfhRequestDates,
        extraRuleFrom: EXTRA_DAY_RULE_FROM,
      },
    };
  });
}

/**
 * Pairs every extra day since the rule date with the missed days before it
 * (lib/attendance/extra-days.ts). Walks each month from 60 days before the rule date
 * through the current month with every extra day provisionally banked — what a day
 * IS (absent, extra, …) never depends on the pairing, only what it is worth — then
 * matches them in date order. `lookups` must cover that whole span (loadSpan).
 */
export function buildExtraDayLedger(lookups: MonthLookups, now: Date = new Date()): ExtraDayLedger {
  const startKey = addDaysKey(EXTRA_DAY_RULE_FROM, -BALANCE_WINDOW_DAYS);
  const todayKey = dateKey(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
  const missed: MissedUnit[] = [];
  const extras: ExtraDay[] = [];
  const first = Number(startKey.slice(0, 4)) * 12 + Number(startKey.slice(5, 7)) - 1;
  const last = now.getFullYear() * 12 + now.getMonth();
  for (let i = first; i <= last; i++) {
    const r = classifyMonth((i % 12) + 1, Math.floor(i / 12), {
      ...lookups,
      extraRuleFrom: EXTRA_DAY_RULE_FROM,
      extraVerdicts: undefined,
      madeUpOn: undefined,
      today: now,
    });
    missed.push(...r.missedUnits);
    extras.push(...r.extraDays);
  }
  const usedBalance = new Map<string, string>();
  for (const [covered, earned] of lookups.balanceEarnedFor ?? []) usedBalance.set(earned, covered);
  return matchExtraDays({ missed, extras, usedBalance, todayKey });
}

/** The lookups a month is valued with once the ledger is known: its verdicts, and the
 *  days banked days covered automatically added to the balance-covered days (each
 *  then paid in its own month, "Balance · earned <day>"). */
export function withLedger(lookups: MonthLookups, ledger: ExtraDayLedger, now: Date): MonthLookups {
  const balanceDates = new Set(lookups.balanceDates ?? []);
  const balanceEarnedFor = new Map(lookups.balanceEarnedFor ?? []);
  const coverAmountByDate = new Map<string, { amount: number; by: string }>();
  for (const { by, date, amount } of ledger.coveredBy.values()) {
    balanceDates.add(date);
    balanceEarnedFor.set(date, by);
    const c = coverAmountByDate.get(date);
    if (c) c.amount += amount;
    else coverAmountByDate.set(date, { amount, by });
  }
  return {
    ...lookups,
    balanceDates,
    balanceEarnedFor,
    coveredUnits: new Set(ledger.coveredBy.keys()),
    coverAmountByDate,
    extraVerdicts: ledger.verdicts,
    madeUpOn: ledger.madeUpOn,
    madeUpAmount: ledger.madeUpAmount,
    today: now,
  };
}

/** One month, with the extra-day ledger it was valued by. */
function classifyWithLedger(
  month: number,
  year: number,
  lookups: MonthLookups,
  now: Date,
): { breakdown: MonthlyBreakdown; ledger: ExtraDayLedger } {
  const ledger = buildExtraDayLedger(lookups, now);
  const breakdown = classifyMonth(month, year, withLedger(lookups, ledger, now));
  return { breakdown, ledger };
}

const EMPTY_LEDGER: ExtraDayLedger = { verdicts: new Map(), madeUpOn: new Map(), madeUpAmount: new Map(), coveredBy: new Map(), bank: [] };

/** One employee's month plus the extra-day ledger (balance days, make-ups) behind it. */
export async function getMonthlyAttendanceWithLedger(
  employeeId: string,
  month: number,
  year: number,
  now: Date = new Date(),
): Promise<{ breakdown: MonthlyBreakdown; ledger: ExtraDayLedger }> {
  const [loaded] = await loadLookups({ id: employeeId }, loadSpan(month, year, now));
  if (!loaded) {
    // No such employee: nothing to walk (an empty month, as before).
    const breakdown = classifyMonth(month, year, {
      attendanceByDate: new Map(),
      holidayDates: new Set(),
      defaultOffDay: 0,
      movedOffDateByWeek: new Map(),
      dateOfJoining: new Date(Date.UTC(year, month, 1)),
      today: now,
    });
    return { breakdown, ledger: EMPTY_LEDGER };
  }
  return classifyWithLedger(month, year, loaded.lookups, now);
}

/**
 * A part-timer's approved paid leave that the monthly quota didn't need, for each of
 * `months` (2026-11-01): it is not paid, and lib/leave/balance.ts gives it back to the
 * leave balance. 0 for a fixed schedule, before the rule month, and for a month not
 * started. One load for all the months.
 */
export async function getUnusedPaidLeaveDays(
  employeeId: string,
  months: { month: number; year: number }[],
  now: Date = new Date(),
): Promise<number[]> {
  const ruleMonth = EXTRA_DAY_RULE_FROM.slice(0, 7);
  const wanted = months.filter((m) => `${m.year}-${String(m.month).padStart(2, "0")}` >= ruleMonth);
  if (wanted.length === 0) return months.map(() => 0);
  const keyOf = (m: { month: number; year: number }) => m.year * 12 + m.month - 1;
  const sorted = [...wanted].sort((a, b) => keyOf(a) - keyOf(b));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const [loaded] = await loadLookups(
    { id: employeeId },
    weekSpan(new Date(Date.UTC(first.year, first.month - 1, 1)), new Date(Date.UTC(last.year, last.month, 1))),
  );
  if (!loaded) return months.map(() => 0);
  return months.map((m) =>
    `${m.year}-${String(m.month).padStart(2, "0")}` >= ruleMonth
      ? classifyMonth(m.month, m.year, { ...loaded.lookups, today: now }).paidLeaveUnused
      : 0,
  );
}

export async function getMonthlyAttendanceBreakdown(
  employeeId: string,
  month: number,
  year: number,
): Promise<MonthlyBreakdown> {
  return (await getMonthlyAttendanceWithLedger(employeeId, month, year)).breakdown;
}

export type EmployeeMonthlyBreakdown = Omit<MonthlyBreakdown, "days"> & {
  /** Only present when the caller asked for it (`includeDays`). */
  days?: ClassifiedDay[];
  employeeId: string;
  fullName: string;
  employmentType: EmploymentType;
  requiredDaysPerWeek: number | null;
  team: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
};

/** Same as getMonthlyAttendanceBreakdown but for every active employee in one
 *  pass (a fixed number of bulk queries, not N×) — used by the Admin/HR monthly table. */
export async function getMonthlyAttendanceBreakdownForAllEmployees(
  month: number,
  year: number,
  opts: { includeDays?: boolean } = {},
): Promise<EmployeeMonthlyBreakdown[]> {
  const now = new Date();
  const loaded = await loadLookups(
    { status: "active", role: { notIn: ATTENDANCE_EXEMPT_ROLES } },
    loadSpan(month, year, now),
  );
  return loaded.map(({ employee: e, lookups }) => {
    const { breakdown } = classifyWithLedger(month, year, lookups, now);
    // The day-by-day list is for one employee's calendar; the company-wide
    // table only needs the counts, so it isn't shipped per row.
    const { days, ...counts } = breakdown;
    return {
      employeeId: e.id,
      fullName: e.fullName,
      employmentType: e.employmentType,
      requiredDaysPerWeek: e.requiredDaysPerWeek,
      team: e.team ? { id: e.team.id, name: e.team.name } : null,
      department: e.department,
      ...counts,
      ...(opts.includeDays ? { days } : {}),
    };
  });
}
