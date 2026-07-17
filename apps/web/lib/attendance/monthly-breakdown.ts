import { AttendanceApprovalStatus, RequestStatus, RequestType } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

// Track A (2026-07-17). Reporting-only day-by-day attendance classification —
// present/absent/leave/holiday/compensation counts for a calendar month.
// Does NOT feed the payroll deduction formula (lib/payroll/calc.ts still
// reads only lib/attendance/summary.ts's late/half-day/unpaid-leave counts);
// this is purely for display (employee profile, admin monthly table, payslip
// generation preview).
//
// Weekend rule (confirmed with Umang, 2026-07-17): only SUNDAY is a day off.
// Saturday is a normal working day. If an employee has an *approved*
// attendance record with a clock-in on a Sunday, that day counts as a
// COMPENSATION day (shown as its own stat, never netted against absences) —
// a new concept, not previously in the system. Every other day (Mon-Sat) is
// classified in priority order: holiday > present/half-day > paid leave >
// unpaid leave > absent.

export type MonthlyBreakdown = {
  presentDays: number;
  halfDays: number;
  holidayDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
  compensationDays: number;
  /** Mon-Sat days considered so far (present+half+holiday+paidLeave+unpaidLeave+absent). */
  workingDaysElapsed: number;
};

type DayAttendance = { hasClockIn: boolean; isHalfDay: boolean };

type MonthLookups = {
  attendanceByDate: Map<string, DayAttendance>;
  leaveTypeByDate: Map<string, RequestType>;
  holidayDates: Set<string>;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
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
  for (let day = 1; day <= through; day++) {
    const date = new Date(Date.UTC(year, month - 1, day));
    const key = dateKey(date);
    const attendance = lookups.attendanceByDate.get(key);

    if (date.getUTCDay() === 0) {
      // Sunday: off unless the employee actually clocked in (approved).
      if (attendance?.hasClockIn) result.compensationDays += 1;
      continue;
    }

    result.workingDaysElapsed += 1;

    if (lookups.holidayDates.has(key)) {
      result.holidayDays += 1;
    } else if (attendance?.hasClockIn) {
      if (attendance.isHalfDay) result.halfDays += 1;
      else result.presentDays += 1;
    } else {
      const leaveType = lookups.leaveTypeByDate.get(key);
      if (leaveType === RequestType.leave_paid) result.paidLeaveDays += 1;
      else if (leaveType === RequestType.leave_unpaid) result.unpaidLeaveDays += 1;
      else result.absentDays += 1;
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

export async function getMonthlyAttendanceBreakdown(
  employeeId: string,
  month: number,
  year: number,
): Promise<MonthlyBreakdown> {
  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(year, month, 1));

  const [records, leaves, holidays] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: {
        employeeId,
        approvalStatus: AttendanceApprovalStatus.approved,
        date: { gte: periodStart, lt: periodEnd },
      },
      select: { date: true, clockInApproved: true, isHalfDay: true },
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
  ]);

  const attendanceByDate = new Map<string, DayAttendance>();
  for (const r of records) {
    attendanceByDate.set(dateKey(r.date), { hasClockIn: !!r.clockInApproved, isHalfDay: r.isHalfDay });
  }

  const leaveTypeByDate = new Map<string, RequestType>();
  for (const l of leaves) {
    if (!l.dateFrom || !l.dateTo) continue;
    expandLeaveIntoMonth(l.dateFrom, l.dateTo, l.type, month, year, (key, type) => {
      leaveTypeByDate.set(key, type);
    });
  }

  const holidayDates = new Set(holidays.map((h) => dateKey(h.date)));

  return classifyMonth(month, year, { attendanceByDate, leaveTypeByDate, holidayDates });
}

export type EmployeeMonthlyBreakdown = MonthlyBreakdown & {
  employeeId: string;
  fullName: string;
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

  const [employees, records, leaves, holidays] = await Promise.all([
    prisma.employee.findMany({
      where: { status: "active" },
      select: {
        id: true,
        fullName: true,
        team: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
      },
      orderBy: { fullName: "asc" },
    }),
    prisma.attendanceRecord.findMany({
      where: {
        approvalStatus: AttendanceApprovalStatus.approved,
        date: { gte: periodStart, lt: periodEnd },
      },
      select: { employeeId: true, date: true, clockInApproved: true, isHalfDay: true },
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
  ]);

  const holidayDates = new Set(holidays.map((h) => dateKey(h.date)));

  const attendanceByEmployee = new Map<string, Map<string, DayAttendance>>();
  for (const r of records) {
    let m = attendanceByEmployee.get(r.employeeId);
    if (!m) {
      m = new Map();
      attendanceByEmployee.set(r.employeeId, m);
    }
    m.set(dateKey(r.date), { hasClockIn: !!r.clockInApproved, isHalfDay: r.isHalfDay });
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
    });
    return {
      employeeId: e.id,
      fullName: e.fullName,
      team: e.team,
      department: e.department,
      ...breakdown,
    };
  });
}
