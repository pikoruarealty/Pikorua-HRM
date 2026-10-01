import { AttendanceApprovalStatus, EmploymentType, RequestStatus, RequestType } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { addDays, buildMovedOffDateByWeek, isOffDay, resolveDefaultOffDay, weekStartOf } from "@/lib/attendance/week";
import { dayCredit } from "@/lib/attendance/time";
import { addLeaveToDay, isPaidLeaveType, type LeaveDayEntry } from "@/lib/requests/leave-math";
import { ATTENDANCE_EXEMPT_ROLES } from "@/lib/attendance/tracking";
import { resolveWeekOff, type WeekOff } from "@/lib/attendance/weekly-off";

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

export type MonthlyBreakdown = {
  presentDays: number;
  halfDays: number;
  holidayDays: number;
  /** Paid leave in days — fractional when half-day leave is involved. */
  paidLeaveDays: number;
  /** Unpaid leave in days — fractional when half-day leave is involved. */
  unpaidLeaveDays: number;
  /** Absent in days. Fractional for half a day of leave with the rest unworked, and
   *  for a part-timer's weekly-quota shortfall. */
  absentDays: number;
  compensationDays: number;
  /** Expected working days considered so far (present+half+holiday+paidLeave+unpaidLeave+absent). */
  workingDaysElapsed: number;
  /** Days that count toward pay: present + half×0.5 + paid leave + holiday +
   *  compensation — the exact sum of `days[].credit` and the numerator of
   *  lib/payroll/calc.ts's earned-pay formula. */
  payableDays: number;
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
   *  - declared_unpaid: the employee switched an automatic weekly off to unpaid. */
  note?: "auto_off" | "provisional_off" | "declared_unpaid";
  /** What the day is worth toward pay, in days (0, 0.5, 1). */
  credit: number;
  /** Leave applied to this day, in days — present only when > 0. A half-day leave
   *  on a half-day worked is {leavePaid: 0.5}: 0.5 worked + 0.5 leave = a full day. */
  leavePaid?: number;
  leaveUnpaid?: number;
  /** The part of the day counted absent, when it is only part of it (a half-day
   *  leave and nothing else that day). Absent on a plain `absent` day (= 1). */
  absentPart?: number;
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
  /** Overrides "today" — for tests; defaults to the real date. */
  today?: Date;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

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
function applyLeave(worked: number, leave: LeaveDayEntry | undefined): { paid: number; unpaid: number } {
  const room = Math.max(0, 1 - worked);
  const paid = Math.min(leave?.paid ?? 0, room);
  const unpaid = Math.min(leave?.unpaid ?? 0, room - paid);
  return { paid, unpaid };
}

export function classifyMonth(month: number, year: number, lookups: MonthLookups): MonthlyBreakdown {
  const result: MonthlyBreakdown = {
    presentDays: 0,
    halfDays: 0,
    holidayDays: 0,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    absentDays: 0,
    compensationDays: 0,
    workingDaysElapsed: 0,
    payableDays: 0,
    creditedWorkingDays: 0,
    absentDates: [],
    days: [],
  };

  const now = lookups.today ?? new Date();
  const through = lastElapsedDay(month, year, now);
  const from = firstElapsedDay(month, year, lookups.dateOfJoining);
  if (through === 0) return result;
  const todayKey = dateKey(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
  const declaredUnpaid = lookups.declaredUnpaidDates ?? new Set<string>();

  const leaveFor = (key: string): LeaveDayEntry | undefined => {
    const entry = lookups.leaveByDate?.get(key);
    if (entry) return entry;
    const legacy = lookups.leaveTypeByDate?.get(key);
    if (!legacy) return undefined;
    return isPaidLeaveType(legacy) ? { paid: 1, unpaid: 0 } : { paid: 0, unpaid: 1 };
  };
  const hasLeave = (key: string) => {
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
            result.compensationDays += 1;
            result.days.push({ date: key, status: "compensation", credit: 1 });
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
        // Manually flagged compensation day — same treatment as an
        // off-day comp day: paid, but not counted as a regular working day.
        result.compensationDays += 1;
        result.days.push({ date: key, status: "compensation", credit: 1 });
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
      const { paid, unpaid } = applyLeave(worked, leave);
      // Only a day with nothing worked can be absent; a short day is a half-day,
      // not "half absent".
      let absent = worked === 0 ? 1 - paid - unpaid : 0;
      // Today isn't over: what would be absent is still to be earned.
      const pendingToday = key === todayKey && absent > 0;
      if (pendingToday) absent = 0;

      result.paidLeaveDays += paid;
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
        result.days.push({
          date: key,
          status: "paid_leave",
          credit: paid,
          ...leaveFields,
          ...(absent > 0 ? { absentPart: absent } : {}),
        });
      } else if (unpaid > 0) {
        result.days.push({
          date: key,
          status: "unpaid_leave",
          credit: 0,
          ...leaveFields,
          ...(absent > 0 ? { absentPart: absent } : {}),
          ...(declared && !leaveFor(key) ? { note: "declared_unpaid" as const } : {}),
        });
      } else if (pendingToday) {
        result.days.push({ date: key, status: "today", credit: 0 });
      } else {
        // Nothing worked and nothing covering it: a whole absent day. (A day that is
        // only half absent — half-day leave, nothing worked — is counted in
        // absentDays through its leave branch above and is deliberately not listed
        // in absentDates: a compensation credit covers whole days.)
        result.absentDates.push(date);
        result.days.push({ date: key, status: "absent", credit: 0 });
      }
    }

    return finish(result, isFlexible, 0);
  }

  // Flexible schedule (part-time / flexible intern):
  // Group days in the month by ISO week. Quota is evaluated per week.
  const required = lookups.requiredDaysPerWeek!;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

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

    for (const date of week.elapsedDays) {
      const key = dateKey(date);
      const attendance = lookups.attendanceByDate.get(key);

      // Still being worked today: counted once the session closes.
      if (isLiveDay(key, attendance) && !lookups.holidayDates.has(key)) {
        weekDays.push({ date: key, status: "live", credit: 0 });
        continue;
      }

      if (attendance?.isCompensation) {
        result.compensationDays += 1;
        weekDays.push({ date: key, status: "compensation", credit: 1 });
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
        if (weekDays[i]!.status === "present") {
          weekDays[i]!.status = "compensation";
          toRelabel -= 1;
        }
      }
    } else {
      result.presentDays += weekPresent;

      const endOfWeek = addDays(week.weekStart, 6);
      const isWeekPast = endOfWeek.getTime() < todayUTC;

      if (isWeekPast) {
        const missing = Math.max(0, targetForChunk - creditedDays);
        result.absentDays += absentShortfall(missing);
        result.workingDaysElapsed += targetForChunk;
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
  result.creditedWorkingDays = isFlexible
    ? flexibleCredited
    : result.presentDays + result.halfDays * 0.5 + result.holidayDays + result.paidLeaveDays;
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
}): DayAttendance {
  const hasClockIn = !!(r.clockInApproved ?? r.clockInRaw);
  return {
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

export async function getMonthlyAttendanceBreakdown(
  employeeId: string,
  month: number,
  year: number,
): Promise<MonthlyBreakdown> {
  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(year, month, 1));
  const span = weekSpan(periodStart, periodEnd);

  const [records, leaves, holidays, offDayContext, declared] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: {
        employeeId,
        approvalStatus: AttendanceApprovalStatus.approved,
        date: { gte: span.start, lt: span.endExclusive },
      },
      select: {
        date: true,
        clockInApproved: true,
        clockInRaw: true,
        clockOutApproved: true,
        clockOutRaw: true,
        isHalfDay: true,
        isCompensation: true,
        totalHours: true,
      },
    }),
    prisma.request.findMany({
      where: {
        employeeId,
        type: { in: ALL_LEAVE_TYPES },
        status: RequestStatus.approved,
        dateFrom: { lt: span.endExclusive },
        dateTo: { gte: span.start },
      },
      select: { dateFrom: true, dateTo: true, type: true, halfDay: true },
    }),
    prisma.holiday.findMany({
      where: { date: { gte: span.start, lt: span.endExclusive } },
      select: { date: true },
    }),
    getOffDayContext(employeeId, periodStart, periodEnd),
    prisma.unpaidDayDeclaration.findMany({
      where: { employeeId, date: { gte: span.start, lt: span.endExclusive } },
      select: { date: true },
    }),
  ]);

  const attendanceByDate = new Map<string, DayAttendance>();
  for (const r of records) attendanceByDate.set(dateKey(r.date), toDayAttendance(r));

  const holidayDates = new Set(holidays.map((h) => dateKey(h.date)));
  const declaredUnpaidDates = new Set(declared.map((d) => dateKey(d.date)));

  return classifyMonth(month, year, {
    attendanceByDate,
    leaveByDate: buildLeaveByDate(leaves, span),
    holidayDates,
    declaredUnpaidDates,
    ...offDayContext,
  });
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
 *  pass (3 bulk queries total, not 3*N) — used by the Admin/HR monthly table. */
export async function getMonthlyAttendanceBreakdownForAllEmployees(
  month: number,
  year: number,
  opts: { includeDays?: boolean } = {},
): Promise<EmployeeMonthlyBreakdown[]> {
  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(year, month, 1));
  const span = weekSpan(periodStart, periodEnd);

  const [employees, records, leaves, holidays, moves, declared] = await Promise.all([
    prisma.employee.findMany({
      where: { status: "active", role: { notIn: ATTENDANCE_EXEMPT_ROLES } },
      select: {
        id: true,
        fullName: true,
        employmentType: true,
        requiredDaysPerWeek: true,
        defaultWeeklyOffDay: true,
        dateOfJoining: true,
        team: { select: { id: true, name: true, defaultWeeklyOffDay: true } },
        department: { select: { id: true, name: true } },
      },
      orderBy: { fullName: "asc" },
    }),
    prisma.attendanceRecord.findMany({
      where: {
        approvalStatus: AttendanceApprovalStatus.approved,
        date: { gte: span.start, lt: span.endExclusive },
      },
      select: {
        employeeId: true,
        date: true,
        clockInApproved: true,
        clockInRaw: true,
        clockOutApproved: true,
        clockOutRaw: true,
        isHalfDay: true,
        isCompensation: true,
        totalHours: true,
      },
    }),
    prisma.request.findMany({
      where: {
        type: { in: ALL_LEAVE_TYPES },
        status: RequestStatus.approved,
        dateFrom: { lt: span.endExclusive },
        dateTo: { gte: span.start },
      },
      select: { employeeId: true, dateFrom: true, dateTo: true, type: true, halfDay: true },
    }),
    prisma.holiday.findMany({
      where: { date: { gte: span.start, lt: span.endExclusive } },
      select: { date: true },
    }),
    prisma.weeklyOffMove.findMany({
      where: {
        active: true,
        weekStart: { gte: addDays(weekStartOf(periodStart), -7), lt: addDays(periodEnd, 7) },
      },
      select: { employeeId: true, weekStart: true, date: true },
    }),
    prisma.unpaidDayDeclaration.findMany({
      where: { date: { gte: span.start, lt: span.endExclusive } },
      select: { employeeId: true, date: true },
    }),
  ]);
  const declaredByEmployee = new Map<string, Set<string>>();
  for (const d of declared) {
    const s = declaredByEmployee.get(d.employeeId) ?? new Set<string>();
    s.add(dateKey(d.date));
    declaredByEmployee.set(d.employeeId, s);
  }

  const holidayDates = new Set(holidays.map((h) => dateKey(h.date)));

  const movesByEmployee = new Map<string, { weekStart: Date; date: Date }[]>();
  for (const m of moves) {
    const list = movesByEmployee.get(m.employeeId);
    if (list) list.push(m);
    else movesByEmployee.set(m.employeeId, [m]);
  }

  const attendanceByEmployee = new Map<string, Map<string, DayAttendance>>();
  for (const r of records) {
    let m = attendanceByEmployee.get(r.employeeId);
    if (!m) {
      m = new Map();
      attendanceByEmployee.set(r.employeeId, m);
    }
    m.set(dateKey(r.date), toDayAttendance(r));
  }

  const leavesByEmployee = new Map<string, typeof leaves>();
  for (const l of leaves) {
    const list = leavesByEmployee.get(l.employeeId);
    if (list) list.push(l);
    else leavesByEmployee.set(l.employeeId, [l]);
  }

  return employees.map((e) => {
    const breakdown = classifyMonth(month, year, {
      attendanceByDate: attendanceByEmployee.get(e.id) ?? new Map(),
      leaveByDate: buildLeaveByDate(leavesByEmployee.get(e.id) ?? [], span),
      holidayDates,
      defaultOffDay: resolveDefaultOffDay(e.defaultWeeklyOffDay, e.team?.defaultWeeklyOffDay),
      movedOffDateByWeek: buildMovedOffDateByWeek(movesByEmployee.get(e.id) ?? []),
      employmentType: e.employmentType,
      requiredDaysPerWeek: e.requiredDaysPerWeek,
      dateOfJoining: e.dateOfJoining,
      declaredUnpaidDates: declaredByEmployee.get(e.id),
    });
    // The day-by-day list is for one employee's calendar; the company-wide
    // table only needs the counts, so it isn't shipped per row.
    const { days, ...counts } = breakdown;
    return {
      employeeId: e.id,
      fullName: e.fullName,
      employmentType: e.employmentType,
      requiredDaysPerWeek: e.requiredDaysPerWeek,
      team: e.team,
      department: e.department,
      ...counts,
      ...(opts.includeDays ? { days } : {}),
    };
  });
}
