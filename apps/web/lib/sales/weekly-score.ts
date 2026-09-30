import { OfflineClaimStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  expectedWorkingDaysInMonth,
  getMonthlyAttendanceBreakdownForAllEmployees,
} from "@/lib/attendance/monthly-breakdown";
import { addDays, buildMovedOffDateByWeek, dateKey, resolveDefaultOffDay } from "@/lib/attendance/week";
import { todayDateOnly } from "@/lib/attendance/time";
import { getSalesTargetConfig, resolveTargets } from "@/lib/sales/targets";
import { weeklySalesScore, type WeeklySalesResult } from "@/lib/sales/weekly-attainment";

// The DB half of the weekly sales recognition score (2026-09-30). The maths is
// in ./weekly-attainment.ts (pure, unit-tested); this gathers the week's CRM and
// offline-claim activity and the days each rep was actually expected to sell,
// in a fixed number of org-wide queries however many reps there are.

export type WeeklySalesEmployee = {
  id: string;
  dailyCallTarget: number | null;
  monthlySiteVisitTarget: number | null;
  monthlyBookingTarget: number | null;
};

/** `weekEnd` is exclusive. Returns one result per employee passed in. */
export async function gatherWeeklySalesScores(
  weekStart: Date,
  weekEnd: Date,
  employees: WeeklySalesEmployee[],
): Promise<Map<string, WeeklySalesResult>> {
  const results = new Map<string, WeeklySalesResult>();
  if (employees.length === 0) return results;
  const ids = employees.map((e) => e.id);

  const weekDays: Date[] = [];
  for (let d = weekStart; d < weekEnd; d = addDays(d, 1)) weekDays.push(d);
  const inWeek = new Set(weekDays.map(dateKey));

  // A week can straddle two months; each needs its own walk. The month the
  // monthly targets are paced against is the one holding the week's Thursday
  // (the ISO convention for "which month does this week belong to").
  const thursday = addDays(weekStart, 3);
  const refMonth = thursday.getUTCMonth() + 1;
  const refYear = thursday.getUTCFullYear();
  const months = new Map<string, { month: number; year: number }>();
  for (const d of weekDays) {
    const month = d.getUTCMonth() + 1;
    const year = d.getUTCFullYear();
    months.set(`${year}-${month}`, { month, year });
  }

  const refStart = new Date(Date.UTC(refYear, refMonth - 1, 1));
  const refEnd = new Date(Date.UTC(refYear, refMonth, 1));

  const [config, breakdowns, sync, claims, holidays, moves, offDays] = await Promise.all([
    getSalesTargetConfig(weekStart),
    Promise.all(
      [...months.values()].map((m) =>
        getMonthlyAttendanceBreakdownForAllEmployees(m.month, m.year, { includeDays: true }),
      ),
    ),
    prisma.salesActivitySync.groupBy({
      by: ["employeeId"],
      where: { employeeId: { in: ids }, date: { gte: weekStart, lt: weekEnd } },
      _sum: { callsMade: true, siteVisits: true, bookingsConfirmed: true },
    }),
    prisma.offlineActivityClaim.groupBy({
      by: ["employeeId"],
      where: { employeeId: { in: ids }, status: OfflineClaimStatus.approved, date: { gte: weekStart, lt: weekEnd } },
      _sum: { calls: true },
    }),
    prisma.holiday.findMany({ where: { date: { gte: refStart, lt: refEnd } }, select: { date: true } }),
    prisma.weeklyOffMove.findMany({
      where: { employeeId: { in: ids }, active: true, weekStart: { gte: addDays(refStart, -7), lt: addDays(refEnd, 7) } },
      select: { employeeId: true, weekStart: true, date: true },
    }),
    prisma.employee.findMany({
      where: { id: { in: ids } },
      select: { id: true, defaultWeeklyOffDay: true, team: { select: { defaultWeeklyOffDay: true } } },
    }),
  ]);

  const holidayDates = new Set(holidays.map((h) => dateKey(h.date)));
  const offDayByEmployee = new Map(
    offDays.map((e) => [e.id, resolveDefaultOffDay(e.defaultWeeklyOffDay, e.team?.defaultWeeklyOffDay)]),
  );
  const movesByEmployee = new Map<string, { weekStart: Date; date: Date }[]>();
  for (const m of moves) {
    const list = movesByEmployee.get(m.employeeId);
    if (list) list.push(m);
    else movesByEmployee.set(m.employeeId, [m]);
  }

  const activity = new Map<string, { calls: number; siteVisits: number; bookings: number }>();
  for (const r of sync) {
    if (!r.employeeId) continue;
    activity.set(r.employeeId, {
      calls: r._sum.callsMade ?? 0,
      siteVisits: r._sum.siteVisits ?? 0,
      bookings: r._sum.bookingsConfirmed ?? 0,
    });
  }
  for (const r of claims) {
    const a = activity.get(r.employeeId) ?? { calls: 0, siteVisits: 0, bookings: 0 };
    a.calls += r._sum.calls ?? 0;
    activity.set(r.employeeId, a);
  }

  // Per employee: the statuses of this week's days, across every month walked.
  const weekStatuses = new Map<string, { date: string; status: string }[]>();
  for (const monthRows of breakdowns) {
    for (const row of monthRows) {
      const list = weekStatuses.get(row.employeeId) ?? [];
      for (const d of row.days ?? []) if (inWeek.has(d.date)) list.push(d);
      weekStatuses.set(row.employeeId, list);
    }
  }

  const todayKey = dateKey(todayDateOnly());

  for (const emp of employees) {
    const defaultOffDay = offDayByEmployee.get(emp.id) ?? 0;
    const expectedDaysInMonth = expectedWorkingDaysInMonth(refMonth, refYear, {
      holidayDates,
      defaultOffDay,
      movedOffDateByWeek: buildMovedOffDateByWeek(movesByEmployee.get(emp.id) ?? []),
    });

    // A day the rep was expected to be selling: turned up (full or half), or
    // should have and didn't. Off days, holidays and approved leave are out.
    // Today is out while it is still unapproved-and-empty — the day isn't over,
    // so an in-progress morning must not read as a missed day.
    const expectedDaysInWeek = (weekStatuses.get(emp.id) ?? []).filter((d) => {
      if (d.status === "present" || d.status === "half_day") return true;
      return d.status === "absent" && d.date < todayKey;
    }).length;

    const a = activity.get(emp.id) ?? { calls: 0, siteVisits: 0, bookings: 0 };
    results.set(
      emp.id,
      weeklySalesScore({
        calls: a.calls,
        siteVisits: a.siteVisits,
        bookings: a.bookings,
        targets: resolveTargets(emp, config),
        expectedDaysInWeek,
        expectedDaysInMonth,
      }),
    );
  }
  return results;
}
