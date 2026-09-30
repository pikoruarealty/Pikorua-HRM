import { EmploymentType, RequestStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { addDays, dateKey, resolveDefaultOffDay, weekStartOf } from "@/lib/attendance/week";
import { todayDateOnly } from "@/lib/attendance/time";

// Which day is an employee's weekly off in a given week (2026-09-30).
//
// Before this, the off day was the default (Sunday unless overridden) unless the
// employee pressed "Take Weekly Off" — so someone who simply didn't come in on a
// Wednesday without pressing anything was marked absent, even in a week where
// they'd worked their own off day. Owner rule now, in priority order:
//
//  1. An explicit, active WeeklyOffMove wins (the employee claimed a day).
//  2. If the default off day is not worked — it has passed and they stayed home
//     — it stays the week's off, exactly as before.
//  3. Otherwise the week's off hasn't been used ("pending": the default day was
//     worked, or hasn't arrived yet), so the first day that was an unexplained
//     no-show becomes the weekly off automatically. The default day is then an
//     ordinary working day — not a compensation day, because nothing was given
//     up. Until the default day has actually passed this is provisional: if they
//     then stay home on it, it is the off and the earlier no-show is absent.
//  4. No such day → the default day stays the off (worked → compensation day,
//     which mints a credit: that is how an unused weekly off is carried forward).
//
// "Unexplained no-show" means: a past day (today isn't over), not the default
// day, with no approved attendance, no holiday, no approved leave, not a day the
// employee already switched to unpaid leave, and not before they joined.
//
// Pure — the DB loaders below and classifyMonth both feed it.

export type WeekOffInputs = {
  /** Monday (UTC midnight) of the ISO week. */
  weekStart: Date;
  defaultOffDay: number;
  /** Active WeeklyOffMove date for this week, YYYY-MM-DD. */
  explicitOffDate?: string | null;
  /** Days with an approved clock-in. */
  workedDates: Set<string>;
  holidayDates: Set<string>;
  /** Days covered by an approved leave request of any kind. */
  leaveDates: Set<string>;
  /** Days the employee switched to unpaid leave themselves. */
  declaredUnpaidDates: Set<string>;
  /** YYYY-MM-DD of "today" — a day after it hasn't happened, today isn't over. */
  todayKey: string;
  /** YYYY-MM-DD of the joining date; earlier days aren't expected of them. */
  joinKey?: string | null;
};

export type WeekOff = {
  /** The day that is this week's off, YYYY-MM-DD. */
  date: string;
  kind: "default" | "claimed" | "auto";
  /** Auto-assigned while the default day is still to come, so it can still flip. */
  provisional: boolean;
  /** This week's default off day, YYYY-MM-DD. */
  defaultDate: string;
};

export function resolveWeekOff(i: WeekOffInputs): WeekOff {
  const days: string[] = [];
  for (let n = 0; n < 7; n++) days.push(dateKey(addDays(i.weekStart, n)));
  const defaultDate = days.find((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === i.defaultOffDay) ?? days[6]!;

  if (i.explicitOffDate) {
    return { date: i.explicitOffDate, kind: "claimed", provisional: false, defaultDate };
  }

  const defaultPending = defaultDate > i.todayKey; // hasn't arrived yet
  const defaultWorked = i.workedDates.has(defaultDate);
  if (!defaultWorked && !defaultPending) {
    return { date: defaultDate, kind: "default", provisional: false, defaultDate };
  }

  const candidate = days.find(
    (d) =>
      d !== defaultDate &&
      d < i.todayKey &&
      !i.workedDates.has(d) &&
      !i.holidayDates.has(d) &&
      !i.leaveDates.has(d) &&
      !i.declaredUnpaidDates.has(d) &&
      (!i.joinKey || d >= i.joinKey),
  );
  if (candidate) return { date: candidate, kind: "auto", provisional: defaultPending, defaultDate };
  return { date: defaultDate, kind: "default", provisional: false, defaultDate };
}

/** A fixed-schedule employee has one weekly off a week; a flexible one
 *  (part-time/intern on a days-per-week quota) has none to resolve. */
export function isFixedSchedule(e: { employmentType: EmploymentType; requiredDaysPerWeek: number | null }): boolean {
  const flexible =
    e.employmentType !== EmploymentType.fulltime &&
    e.requiredDaysPerWeek != null &&
    e.requiredDaysPerWeek > 0 &&
    e.requiredDaysPerWeek < 7;
  return !flexible;
}

/**
 * The resolved weekly off of many employees for one week, in a fixed number of
 * queries. Flexible-schedule employees are left out of the map.
 */
export async function loadWeekOffs(weekStart: Date, employeeIds: string[]): Promise<Map<string, WeekOff>> {
  const out = new Map<string, WeekOff>();
  if (employeeIds.length === 0) return out;
  const weekEnd = addDays(weekStart, 7); // exclusive
  const todayKey = dateKey(todayDateOnly());

  const [employees, records, holidays, leaves, declared, moves] = await Promise.all([
    prisma.employee.findMany({
      where: { id: { in: employeeIds } },
      select: {
        id: true,
        employmentType: true,
        requiredDaysPerWeek: true,
        defaultWeeklyOffDay: true,
        dateOfJoining: true,
        team: { select: { defaultWeeklyOffDay: true } },
      },
    }),
    prisma.attendanceRecord.findMany({
      where: {
        employeeId: { in: employeeIds },
        approvalStatus: "approved",
        date: { gte: weekStart, lt: weekEnd },
        OR: [{ clockInApproved: { not: null } }, { clockInRaw: { not: null } }],
      },
      select: { employeeId: true, date: true },
    }),
    prisma.holiday.findMany({ where: { date: { gte: weekStart, lt: weekEnd } }, select: { date: true } }),
    prisma.request.findMany({
      where: {
        employeeId: { in: employeeIds },
        type: { in: ["leave_casual", "leave_sick", "leave_unpaid"] },
        status: RequestStatus.approved,
        dateFrom: { lt: weekEnd },
        dateTo: { gte: weekStart },
      },
      select: { employeeId: true, dateFrom: true, dateTo: true },
    }),
    prisma.unpaidDayDeclaration.findMany({
      where: { employeeId: { in: employeeIds }, date: { gte: weekStart, lt: weekEnd } },
      select: { employeeId: true, date: true },
    }),
    prisma.weeklyOffMove.findMany({
      where: { employeeId: { in: employeeIds }, active: true, weekStart },
      select: { employeeId: true, date: true },
    }),
  ]);

  const holidayDates = new Set(holidays.map((h) => dateKey(h.date)));
  const group = <T extends { employeeId: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const list = m.get(r.employeeId);
      if (list) list.push(r);
      else m.set(r.employeeId, [r]);
    }
    return m;
  };
  const recordsBy = group(records);
  const leavesBy = group(leaves);
  const declaredBy = group(declared);
  const moveBy = new Map(moves.map((m) => [m.employeeId, dateKey(m.date)]));

  for (const e of employees) {
    if (!isFixedSchedule(e)) continue;
    const leaveDates = new Set<string>();
    for (const l of leavesBy.get(e.id) ?? []) {
      if (!l.dateFrom || !l.dateTo) continue;
      for (let t = Math.max(l.dateFrom.getTime(), weekStart.getTime()); t <= l.dateTo.getTime() && t < weekEnd.getTime(); t += 86_400_000) {
        leaveDates.add(dateKey(new Date(t)));
      }
    }
    out.set(
      e.id,
      resolveWeekOff({
        weekStart,
        defaultOffDay: resolveDefaultOffDay(e.defaultWeeklyOffDay, e.team?.defaultWeeklyOffDay),
        explicitOffDate: moveBy.get(e.id) ?? null,
        workedDates: new Set((recordsBy.get(e.id) ?? []).map((r) => dateKey(r.date))),
        holidayDates,
        leaveDates,
        declaredUnpaidDates: new Set((declaredBy.get(e.id) ?? []).map((d) => dateKey(d.date))),
        todayKey,
        joinKey: dateKey(e.dateOfJoining),
      }),
    );
  }
  return out;
}

/** One employee's weekly off for the week containing `date`; null for a
 *  flexible-schedule employee. */
export async function getWeekOff(employeeId: string, date: Date): Promise<WeekOff | null> {
  return (await loadWeekOffs(weekStartOf(date), [employeeId])).get(employeeId) ?? null;
}
