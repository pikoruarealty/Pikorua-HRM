import { AttendanceApprovalStatus, EmploymentType, RequestStatus, RequestType } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { addDays, buildMovedOffDateByWeek, isOffDay, resolveDefaultOffDay, weekStartOf } from "@/lib/attendance/week";
import { dayCredit } from "@/lib/attendance/time";

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
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** First day of the month to walk: day 1, or the joining day for someone who
 *  joined mid-month. Days before an employee existed are not absences — they
 *  used to be counted as such, deducting a full month's pay from a new hire's
 *  first payslip and sinking their attendance score to near zero. */
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
function lastElapsedDay(month: number, year: number): number {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const now = new Date();
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
  };

  const through = lastElapsedDay(month, year);
  const from = firstElapsedDay(month, year, lookups.dateOfJoining);
  if (through === 0 || from > through) return result;

  const isFlexible =
    lookups.employmentType !== "fulltime" &&
    lookups.requiredDaysPerWeek != null &&
    lookups.requiredDaysPerWeek > 0 &&
    lookups.requiredDaysPerWeek < 7;

  if (!isFlexible) {
    // Standard full-time (or fixed schedule) day-by-day classification
    for (let day = from; day <= through; day++) {
      const date = new Date(Date.UTC(year, month - 1, day));
      const key = dateKey(date);
      const attendance = lookups.attendanceByDate.get(key);

      if (isOffDay(date, lookups.defaultOffDay, lookups.movedOffDateByWeek)) {
        // Off day (default, or this employee's WeeklyOffMove for this
        // week): skipped unless the employee actually clocked in (approved).
        if (attendance?.hasClockIn) result.compensationDays += 1;
        continue;
      }

      if (attendance?.isCompensation) {
        // Manually flagged compensation day — same treatment as an
        // off-day comp day: paid, but not counted as a regular working day.
        result.compensationDays += 1;
        continue;
      }

      result.workingDaysElapsed += 1;

      if (lookups.holidayDates.has(key)) {
        result.holidayDays += 1;
      } else if (attendance?.hasClockIn) {
        // A recorded day of zero hours is not attendance — it lands in the
        // same bucket as not turning up.
        const credit = dayCredit(attendance.totalHours, attendance.isHalfDay);
        if (credit === 1) result.presentDays += 1;
        else if (credit === 0.5) result.halfDays += 1;
        else result.absentDays += 1;
      } else {
        const leaveType = lookups.leaveTypeByDate.get(key);
        if (leaveType === RequestType.leave_paid) result.paidLeaveDays += 1;
        else if (leaveType === RequestType.leave_unpaid) result.unpaidLeaveDays += 1;
        else result.absentDays += 1;
      }
    }

    return result;
  }

  // Flexible schedule (part-time / flexible intern):
  // Group days in the month by ISO week. Quota is evaluated per week.
  const required = lookups.requiredDaysPerWeek!;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const now = new Date();
  const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

  const weeksMap = new Map<string, { weekStart: Date; allDaysInMonth: Date[]; elapsedDays: Date[] }>();
  for (let day = from; day <= daysInMonth; day++) {
    // Starting at `from` also pro-rates the joining week's quota: a part-timer
    // who joins on a Thursday owes that week a share, not the full weekly target.
    const date = new Date(Date.UTC(year, month - 1, day));
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

    for (const date of week.elapsedDays) {
      const key = dateKey(date);
      const attendance = lookups.attendanceByDate.get(key);

      if (attendance?.isCompensation) {
        result.compensationDays += 1;
        continue;
      }

      if (lookups.holidayDates.has(key)) {
        weekHoliday += 1;
      } else if (attendance?.hasClockIn) {
        const credit = dayCredit(attendance.totalHours, attendance.isHalfDay);
        if (credit === 1) weekPresent += 1;
        else if (credit === 0.5) weekHalf += 1;
        // credit 0: nothing worked, so it counts toward neither — the week's
        // quota shortfall picks it up as an absence below.
      } else {
        const leaveType = lookups.leaveTypeByDate.get(key);
        if (leaveType === RequestType.leave_paid) weekPaidLeave += 1;
        else if (leaveType === RequestType.leave_unpaid) weekUnpaidLeave += 1;
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
  }

  return result;
}

/** Expands an approved leave request's [dateFrom, dateTo] range into
 *  per-date entries within the given month only. */
function expandLeaveIntoMonth(
  dateFrom: Date,
  dateTo: Date,
  type: RequestType,
  month: number,
  year: number,
  onDate: (key: string, type: RequestType) => void,
) {
  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(year, month, 1)); // exclusive
  const start = dateFrom < periodStart ? periodStart : dateFrom;
  const end = dateTo < periodEnd ? dateTo : new Date(periodEnd.getTime() - MS_PER_DAY);
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
 *  [rangeStart, rangeEnd) — the context isOffDay() and classification need. */
async function getOffDayContext(
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

  const [records, leaves, holidays, offDayContext] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: {
        employeeId,
        approvalStatus: AttendanceApprovalStatus.approved,
        date: { gte: periodStart, lt: periodEnd },
      },
      select: { date: true, clockInApproved: true, isHalfDay: true, isCompensation: true, totalHours: true },
    }),
    prisma.request.findMany({
      where: {
        employeeId,
        type: { in: [RequestType.leave_paid, RequestType.leave_unpaid] },
        status: RequestStatus.approved,
        dateFrom: { lte: new Date(periodEnd.getTime() - MS_PER_DAY) },
        dateTo: { gte: periodStart },
      },
      select: { dateFrom: true, dateTo: true, type: true },
    }),
    prisma.holiday.findMany({
      where: { date: { gte: periodStart, lt: periodEnd } },
      select: { date: true },
    }),
    getOffDayContext(employeeId, periodStart, periodEnd),
  ]);

  const attendanceByDate = new Map<string, DayAttendance>();
  for (const r of records) {
    attendanceByDate.set(dateKey(r.date), {
      hasClockIn: !!r.clockInApproved,
      isHalfDay: r.isHalfDay,
      isCompensation: r.isCompensation,
      totalHours: r.totalHours === null ? null : Number(r.totalHours),
    });
  }

  const leaveTypeByDate = new Map<string, RequestType>();
  for (const l of leaves) {
    if (!l.dateFrom || !l.dateTo) continue;
    expandLeaveIntoMonth(l.dateFrom, l.dateTo, l.type, month, year, (key, type) => {
      leaveTypeByDate.set(key, type);
    });
  }

  const holidayDates = new Set(holidays.map((h) => dateKey(h.date)));

  return classifyMonth(month, year, { attendanceByDate, leaveTypeByDate, holidayDates, ...offDayContext });
}

/** Count of compensation days for one employee within an arbitrary inclusive
 *  date range — used by leave balance to credit compensation days back. */
export async function getCompensationDaysInRange(
  employeeId: string,
  start: Date,
  end: Date,
): Promise<number> {
  const [records, offDayContext] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: {
        employeeId,
        approvalStatus: AttendanceApprovalStatus.approved,
        clockInApproved: { not: null },
        date: { gte: start, lte: end },
      },
      select: { date: true, isCompensation: true },
    }),
    getOffDayContext(employeeId, start, end),
  ]);

  if (
    offDayContext.employmentType &&
    offDayContext.employmentType !== "fulltime" &&
    offDayContext.requiredDaysPerWeek != null &&
    offDayContext.requiredDaysPerWeek > 0
  ) {
    const req = offDayContext.requiredDaysPerWeek;
    const recordsByWeek = new Map<string, { total: number; manualComp: number }>();
    for (const r of records) {
      const wKey = dateKey(weekStartOf(r.date));
      let entry = recordsByWeek.get(wKey);
      if (!entry) {
        entry = { total: 0, manualComp: 0 };
        recordsByWeek.set(wKey, entry);
      }
      if (r.isCompensation) {
        entry.manualComp += 1;
      } else {
        entry.total += 1;
      }
    }
    let totalComp = 0;
    for (const w of recordsByWeek.values()) {
      totalComp += w.manualComp + Math.max(0, w.total - req);
    }
    return totalComp;
  }

  return records.filter(
    (r) => r.isCompensation || isOffDay(r.date, offDayContext.defaultOffDay, offDayContext.movedOffDateByWeek),
  ).length;
}

export type EmployeeMonthlyBreakdown = MonthlyBreakdown & {
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
): Promise<EmployeeMonthlyBreakdown[]> {
  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(year, month, 1));

  const [employees, records, leaves, holidays, moves] = await Promise.all([
    prisma.employee.findMany({
      where: { status: "active" },
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
        date: { gte: periodStart, lt: periodEnd },
      },
      select: {
        employeeId: true,
        date: true,
        clockInApproved: true,
        isHalfDay: true,
        isCompensation: true,
        totalHours: true,
      },
    }),
    prisma.request.findMany({
      where: {
        type: { in: [RequestType.leave_paid, RequestType.leave_unpaid] },
        status: RequestStatus.approved,
        dateFrom: { lte: new Date(periodEnd.getTime() - MS_PER_DAY) },
        dateTo: { gte: periodStart },
      },
      select: { employeeId: true, dateFrom: true, dateTo: true, type: true },
    }),
    prisma.holiday.findMany({
      where: { date: { gte: periodStart, lt: periodEnd } },
      select: { date: true },
    }),
    prisma.weeklyOffMove.findMany({
      where: {
        active: true,
        weekStart: { gte: addDays(weekStartOf(periodStart), -7), lt: addDays(periodEnd, 7) },
      },
      select: { employeeId: true, weekStart: true, date: true },
    }),
  ]);

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
      hasClockIn: !!r.clockInApproved,
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
    expandLeaveIntoMonth(l.dateFrom, l.dateTo, l.type, month, year, (key, type) => {
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
    });
    return {
      employeeId: e.id,
      fullName: e.fullName,
      employmentType: e.employmentType,
      requiredDaysPerWeek: e.requiredDaysPerWeek,
      team: e.team,
      department: e.department,
      ...breakdown,
    };
  });
}
