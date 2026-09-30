import { AttendanceApprovalStatus, EmploymentType, RequestStatus, RequestType } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { addDays, buildMovedOffDateByWeek, isOffDay, resolveDefaultOffDay, weekStartOf } from "@/lib/attendance/week";
import { dayCredit } from "@/lib/attendance/time";
import { isPaidLeaveType } from "@/lib/requests/leave-math";
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

export type MonthlyBreakdown = {
  presentDays: number;
  halfDays: number;
  holidayDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
  compensationDays: number;
  /** Expected working days considered so far (present+half+holiday+paidLeave+unpaidLeave+absent). */
  workingDaysElapsed: number;
  /** The actual dates behind absentDays — fixed-schedule employees only (see
   *  isFlexible below); a flexible employee's absences are a weekly-aggregate
   *  shortfall with no single date to anchor to, so this stays empty for
   *  them. Added 2026-09-18 so lib/attendance/compensation-credits.ts can
   *  redeem a credit against a specific absent day, not just a count. */
  absentDates: Date[];
  /** One entry per day that was actually evaluated (joining date..today), in date
   *  order — the same walk that produced the counts above, so a calendar built
   *  from it can never disagree with the tiles. Days not listed (before the
   *  employee existed, or still in the future) were not evaluated. */
  days: ClassifiedDay[];
};

/** What one evaluated day turned out to be. `no_record` is the flexible-schedule
 *  (part-time / intern) "didn't work this day" — their shortfall is a weekly
 *  aggregate, so no single date is an absence. */
export type DayStatus =
  | "present"
  | "half_day"
  | "compensation"
  | "absent"
  | "paid_leave"
  | "unpaid_leave"
  | "holiday"
  | "weekly_off"
  | "no_record";

export type ClassifiedDay = {
  date: string;
  status: DayStatus;
  /** Why a day has the status it has, where that isn't obvious:
   *  - auto_off: a no-show day turned into the week's weekly off automatically;
   *  - provisional_off: the same, but this week's default off day is still to
   *    come, so it can flip back to absent;
   *  - declared_unpaid: the employee switched an automatic weekly off to unpaid. */
  note?: "auto_off" | "provisional_off" | "declared_unpaid";
};

type DayAttendance = {
  hasClockIn: boolean;
  isHalfDay: boolean;
  isCompensation: boolean;
  /** null while the day is still open (clocked in, not yet out). */
  totalHours: number | null;
};

type MonthLookups = {
  attendanceByDate: Map<string, DayAttendance>;
  leaveTypeByDate: Map<string, RequestType>;
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
    absentDates: [],
    days: [],
  };

  const now = lookups.today ?? new Date();
  const through = lastElapsedDay(month, year, now);
  const from = firstElapsedDay(month, year, lookups.dateOfJoining);
  if (through === 0) return result;
  const todayKey = dateKey(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
  const declaredUnpaid = lookups.declaredUnpaidDates ?? new Set<string>();

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
      if (lookups.leaveTypeByDate.has(k)) leaveDates.add(k);
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

  if (!isFlexible) {
    // Standard full-time (or fixed schedule) day-by-day classification
    for (let day = 1; day <= through; day++) {
      const date = new Date(Date.UTC(year, month - 1, day));
      const key = dateKey(date);
      const attendance = lookups.attendanceByDate.get(key);

      // Before the joining date nothing is owed, but a day that was actually
      // worked (an approved record exists) is still attendance.
      if (day < from && !attendance?.hasClockIn) continue;

      const weekOff = weekOffFor(date);
      if (weekOff.date === key) {
        // The week's off (claimed, automatic, or the default day): skipped
        // unless the employee actually clocked in (approved), which makes it a
        // compensation day. An automatic off is a no-show by construction, so
        // it can never be a comp day.
        if (attendance?.hasClockIn) {
          result.compensationDays += 1;
          result.days.push({ date: key, status: "compensation" });
        } else {
          result.days.push({
            date: key,
            status: "weekly_off",
            ...(weekOff.kind === "auto" ? { note: weekOff.provisional ? "provisional_off" : "auto_off" } : {}),
          } as ClassifiedDay);
        }
        continue;
      }

      if (attendance?.isCompensation) {
        // Manually flagged compensation day — same treatment as an
        // off-day comp day: paid, but not counted as a regular working day.
        result.compensationDays += 1;
        result.days.push({ date: key, status: "compensation" });
        continue;
      }

      result.workingDaysElapsed += 1;

      if (lookups.holidayDates.has(key)) {
        result.holidayDays += 1;
        result.days.push({ date: key, status: "holiday" });
      } else if (attendance?.hasClockIn) {
        // A recorded day of zero hours is not attendance — it lands in the
        // same bucket as not turning up.
        const credit = dayCredit(attendance.totalHours, attendance.isHalfDay);
        if (credit === 1) {
          result.presentDays += 1;
          result.days.push({ date: key, status: "present" });
        } else if (credit === 0.5) {
          result.halfDays += 1;
          result.days.push({ date: key, status: "half_day" });
        } else {
          result.absentDays += 1;
          result.absentDates.push(date);
          result.days.push({ date: key, status: "absent" });
        }
      } else {
        const leaveType = lookups.leaveTypeByDate.get(key);
        if (leaveType && isPaidLeaveType(leaveType)) {
          result.paidLeaveDays += 1;
          result.days.push({ date: key, status: "paid_leave" });
        } else if (leaveType === RequestType.leave_unpaid) {
          result.unpaidLeaveDays += 1;
          result.days.push({ date: key, status: "unpaid_leave" });
        } else if (declaredUnpaid.has(key)) {
          // Switched from an automatic weekly off to unpaid by the employee.
          result.unpaidLeaveDays += 1;
          result.days.push({ date: key, status: "unpaid_leave", note: "declared_unpaid" });
        } else {
          result.absentDays += 1;
          result.absentDates.push(date);
          result.days.push({ date: key, status: "absent" });
        }
      }
    }

    return result;
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

      if (attendance?.isCompensation) {
        result.compensationDays += 1;
        weekDays.push({ date: key, status: "compensation" });
        continue;
      }

      if (lookups.holidayDates.has(key)) {
        weekHoliday += 1;
        weekDays.push({ date: key, status: "holiday" });
      } else if (attendance?.hasClockIn) {
        const credit = dayCredit(attendance.totalHours, attendance.isHalfDay);
        if (credit === 1) {
          weekPresent += 1;
          weekDays.push({ date: key, status: "present" });
        } else if (credit === 0.5) {
          weekHalf += 1;
          weekDays.push({ date: key, status: "half_day" });
        } else {
          // credit 0: nothing worked, so it counts toward neither — the week's
          // quota shortfall picks it up as an absence below.
          weekDays.push({ date: key, status: "no_record" });
        }
      } else {
        const leaveType = lookups.leaveTypeByDate.get(key);
        if (leaveType && isPaidLeaveType(leaveType)) {
          weekPaidLeave += 1;
          weekDays.push({ date: key, status: "paid_leave" });
        } else if (leaveType === RequestType.leave_unpaid) {
          weekUnpaidLeave += 1;
          weekDays.push({ date: key, status: "unpaid_leave" });
        } else {
          weekDays.push({ date: key, status: "no_record" });
        }
      }
    }

    const creditedDays = weekPresent + weekHalf * 0.5 + weekPaidLeave + weekHoliday;

    result.halfDays += weekHalf;
    result.paidLeaveDays += weekPaidLeave;
    result.unpaidLeaveDays += weekUnpaidLeave;
    result.holidayDays += weekHoliday;

    if (creditedDays > targetForChunk) {
      const extra = creditedDays - targetForChunk;
      result.compensationDays += extra;
      result.presentDays += Math.max(0, weekPresent - extra);
      result.workingDaysElapsed += targetForChunk;
      // The week's overflow has no single "extra" day, so the calendar shows the
      // latest worked days of the week as the compensation ones.
      let toRelabel = Math.floor(extra);
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
        result.absentDays += missing;
        result.workingDaysElapsed += targetForChunk;
      } else {
        let daysLeftInWeek = 0;
        for (let i = 0; i < 7; i++) {
          const d = addDays(week.weekStart, i);
          if (d.getTime() > todayUTC) daysLeftInWeek += 1;
        }
        const maxPossible = creditedDays + daysLeftInWeek;
        if (maxPossible < targetForChunk) {
          const unavoidableAbsent = targetForChunk - maxPossible;
          result.absentDays += unavoidableAbsent;
          result.workingDaysElapsed += creditedDays + unavoidableAbsent;
        } else {
          result.workingDaysElapsed += creditedDays;
        }
      }
    }

    result.days.push(...weekDays);
  }

  result.days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
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
      select: { dateFrom: true, dateTo: true, type: true },
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
  for (const r of records) {
    attendanceByDate.set(dateKey(r.date), {
      // A device-synced day is never hand-approved (clockInApproved stays
      // null forever — see lib/integrations/teamoffice/reconcile.ts), so it
      // was silently landing in "absent" here even though approvalStatus is
      // already `approved`. Fall back to clockInRaw, same as
      // attendance/overview's live dashboard read already does.
      hasClockIn: !!(r.clockInApproved ?? r.clockInRaw),
      isHalfDay: r.isHalfDay,
      isCompensation: r.isCompensation,
      totalHours: r.totalHours === null ? null : Number(r.totalHours),
    });
  }

  const leaveTypeByDate = new Map<string, RequestType>();
  for (const l of leaves) {
    if (!l.dateFrom || !l.dateTo) continue;
    expandLeaveIntoRange(l.dateFrom, l.dateTo, l.type, span.start, span.endExclusive, (key, type) => {
      leaveTypeByDate.set(key, type);
    });
  }

  const holidayDates = new Set(holidays.map((h) => dateKey(h.date)));
  const declaredUnpaidDates = new Set(declared.map((d) => dateKey(d.date)));

  return classifyMonth(month, year, {
    attendanceByDate,
    leaveTypeByDate,
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
      select: { employeeId: true, dateFrom: true, dateTo: true, type: true },
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
    m.set(dateKey(r.date), {
      // See the single-employee query above: device-synced days never set
      // clockInApproved, so this must fall back to clockInRaw too.
      hasClockIn: !!(r.clockInApproved ?? r.clockInRaw),
      isHalfDay: r.isHalfDay,
      isCompensation: r.isCompensation,
      totalHours: r.totalHours === null ? null : Number(r.totalHours),
    });
  }

  const leaveByEmployee = new Map<string, Map<string, RequestType>>();
  for (const l of leaves) {
    if (!l.dateFrom || !l.dateTo) continue;
    let m = leaveByEmployee.get(l.employeeId);
    if (!m) {
      m = new Map();
      leaveByEmployee.set(l.employeeId, m);
    }
    expandLeaveIntoRange(l.dateFrom, l.dateTo, l.type, span.start, span.endExclusive, (key, type) => {
      m!.set(key, type);
    });
  }

  return employees.map((e) => {
    const breakdown = classifyMonth(month, year, {
      attendanceByDate: attendanceByEmployee.get(e.id) ?? new Map(),
      leaveTypeByDate: leaveByEmployee.get(e.id) ?? new Map(),
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
