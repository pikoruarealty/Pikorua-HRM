import { OfflineClaimStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  expectedWorkingDaysInMonth,
  getMonthlyAttendanceBreakdownForAllEmployees,
} from "@/lib/attendance/monthly-breakdown";
import {
  addDays,
  buildMovedOffDateByWeek,
  isOffDay,
  resolveDefaultOffDay,
  weekStartOf,
} from "@/lib/attendance/week";
import { attainmentPct, expectedActivityDaysElapsed, proRatedTarget } from "@/lib/sales/pacing";
import { getSalesTargetConfig, resolveTargets } from "@/lib/sales/targets";
import { SALES_ROLES } from "@/lib/sales/provisioning";

// Pillar 5 (2026-08-10) — the Sales Lead / Admin "how is the team tracking
// right now" view, built as the sales counterpart to lib/eod/team-today.ts.
//
// The pacing rule that makes this honest, and the reason it is not just
// "target ÷ days in month": monthly targets are pro-rated against the days a
// rep was actually EXPECTED to sell — weekly offs (including a WeeklyOffMove),
// public holidays and approved leave all come out. Without that, every rep
// looks behind on their day off, and a rep returning from approved leave looks
// like a failure for the rest of the month.

export type SalesRepProgress = {
  employeeId: string;
  fullName: string;
  teamName: string | null;
  /** True when today is this rep's weekly off — the UI greys the row rather
   *  than showing them as missing their daily target. */
  offToday: boolean;
  calls: {
    crm: number;
    offline: number;
    total: number;
    target: number;
    pct: number | null;
  };
  siteVisits: { total: number; monthTarget: number; pacedTarget: number | null; pct: number | null };
  bookings: { total: number; monthTarget: number; pacedTarget: number | null; pct: number | null };
  /** Days elapsed this month on which the rep was expected to be selling. */
  expectedDaysElapsed: number;
  expectedDaysInMonth: number;
  pendingClaims: number;
};

export type SalesTeamProgress = {
  date: string;
  month: number;
  year: number;
  rows: SalesRepProgress[];
  totals: {
    reps: number;
    callsToday: number;
    callTargetToday: number;
    siteVisitsMonth: number;
    siteVisitTargetMonth: number;
    bookingsMonth: number;
    bookingTargetMonth: number;
    /** CRM rows the feed could not attribute to anyone — an admin-visible
     *  warning that somebody's numbers are going nowhere. */
    unmatchedCrmRows: number;
  };
};

export async function buildSalesTeamProgress(
  employeeIds: string[],
  date: Date,
): Promise<SalesTeamProgress> {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));

  const reps = await prisma.employee.findMany({
    where: { id: { in: employeeIds }, status: "active", role: { in: [...SALES_ROLES] } },
    select: {
      id: true,
      fullName: true,
      dailyCallTarget: true,
      monthlySiteVisitTarget: true,
      monthlyBookingTarget: true,
      defaultWeeklyOffDay: true,
      team: { select: { name: true, defaultWeeklyOffDay: true } },
    },
    orderBy: { fullName: "asc" },
  });
  const repIds = reps.map((r) => r.id);

  if (repIds.length === 0) {
    return {
      date: date.toISOString().slice(0, 10),
      month,
      year,
      rows: [],
      totals: {
        reps: 0,
        callsToday: 0,
        callTargetToday: 0,
        siteVisitsMonth: 0,
        siteVisitTargetMonth: 0,
        bookingsMonth: 0,
        bookingTargetMonth: 0,
        unmatchedCrmRows: 0,
      },
    };
  }

  const [config, todaySync, monthSync, claims, pending, holidays, moves, breakdowns, unmatched] =
    await Promise.all([
      getSalesTargetConfig(date),
      prisma.salesActivitySync.findMany({
        where: { employeeId: { in: repIds }, date },
        select: { employeeId: true, callsMade: true },
      }),
      prisma.salesActivitySync.groupBy({
        by: ["employeeId"],
        where: { employeeId: { in: repIds }, date: { gte: monthStart, lt: monthEnd } },
        _sum: { siteVisits: true, bookingsConfirmed: true },
      }),
      prisma.offlineActivityClaim.groupBy({
        by: ["employeeId"],
        where: { employeeId: { in: repIds }, date, status: OfflineClaimStatus.approved },
        _sum: { calls: true },
      }),
      prisma.offlineActivityClaim.groupBy({
        by: ["employeeId"],
        where: { employeeId: { in: repIds }, status: OfflineClaimStatus.pending },
        _count: { _all: true },
      }),
      prisma.holiday.findMany({
        where: { date: { gte: monthStart, lt: monthEnd } },
        select: { date: true },
      }),
      prisma.weeklyOffMove.findMany({
        where: {
          employeeId: { in: repIds },
          active: true,
          weekStart: { gte: addDays(weekStartOf(monthStart), -7), lt: addDays(monthEnd, 7) },
        },
        select: { employeeId: true, weekStart: true, date: true },
      }),
      getMonthlyAttendanceBreakdownForAllEmployees(month, year),
      prisma.salesActivitySync.count({
        where: { employeeId: null, date: { gte: monthStart, lt: monthEnd } },
      }),
    ]);

  const holidayDates = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));

  const movesByEmployee = new Map<string, { weekStart: Date; date: Date }[]>();
  for (const m of moves) {
    const list = movesByEmployee.get(m.employeeId);
    if (list) list.push(m);
    else movesByEmployee.set(m.employeeId, [m]);
  }

  const crmToday = new Map(todaySync.map((s) => [s.employeeId!, s.callsMade]));
  const offlineToday = new Map(claims.map((c) => [c.employeeId, c._sum.calls ?? 0]));
  const pendingCount = new Map(pending.map((p) => [p.employeeId, p._count._all]));
  const monthTotals = new Map(
    monthSync.map((m) => [
      m.employeeId!,
      { siteVisits: m._sum.siteVisits ?? 0, bookings: m._sum.bookingsConfirmed ?? 0 },
    ]),
  );
  const breakdownById = new Map(breakdowns.map((b) => [b.employeeId, b]));

  const rows: SalesRepProgress[] = reps.map((rep) => {
    const targets = resolveTargets(rep, config);
    const movedOffDateByWeek = buildMovedOffDateByWeek(movesByEmployee.get(rep.id) ?? []);
    const defaultOffDay = resolveDefaultOffDay(rep.defaultWeeklyOffDay, rep.team?.defaultWeeklyOffDay);

    const expectedDaysInMonth = expectedWorkingDaysInMonth(month, year, {
      holidayDates,
      defaultOffDay,
      movedOffDateByWeek,
    });
    const breakdown = breakdownById.get(rep.id);
    const expectedDaysElapsed = breakdown ? expectedActivityDaysElapsed(breakdown) : 0;

    const offToday = isOffDay(
      new Date(Date.UTC(year, month - 1, day)),
      defaultOffDay,
      movedOffDateByWeek,
    );

    const crm = crmToday.get(rep.id) ?? 0;
    const offline = offlineToday.get(rep.id) ?? 0;
    const callTotal = crm + offline;
    // On a rep's day off there is no call target to miss.
    const callTarget = offToday ? 0 : targets.dailyCallTarget;

    const totals = monthTotals.get(rep.id) ?? { siteVisits: 0, bookings: 0 };
    const visitPaced = proRatedTarget(
      targets.monthlySiteVisitTarget,
      expectedDaysElapsed,
      expectedDaysInMonth,
    );
    const bookingPaced = proRatedTarget(
      targets.monthlyBookingTarget,
      expectedDaysElapsed,
      expectedDaysInMonth,
    );

    return {
      employeeId: rep.id,
      fullName: rep.fullName,
      teamName: rep.team?.name ?? null,
      offToday,
      calls: {
        crm,
        offline,
        total: callTotal,
        target: callTarget,
        pct: attainmentPct(callTotal, callTarget > 0 ? callTarget : null),
      },
      siteVisits: {
        total: totals.siteVisits,
        monthTarget: targets.monthlySiteVisitTarget,
        pacedTarget: visitPaced,
        pct: attainmentPct(totals.siteVisits, visitPaced),
      },
      bookings: {
        total: totals.bookings,
        monthTarget: targets.monthlyBookingTarget,
        pacedTarget: bookingPaced,
        pct: attainmentPct(totals.bookings, bookingPaced),
      },
      expectedDaysElapsed,
      expectedDaysInMonth,
      pendingClaims: pendingCount.get(rep.id) ?? 0,
    };
  });

  return {
    date: date.toISOString().slice(0, 10),
    month,
    year,
    rows,
    totals: {
      reps: rows.length,
      callsToday: rows.reduce((s, r) => s + r.calls.total, 0),
      callTargetToday: rows.reduce((s, r) => s + r.calls.target, 0),
      siteVisitsMonth: rows.reduce((s, r) => s + r.siteVisits.total, 0),
      siteVisitTargetMonth: rows.reduce((s, r) => s + r.siteVisits.monthTarget, 0),
      bookingsMonth: rows.reduce((s, r) => s + r.bookings.total, 0),
      bookingTargetMonth: rows.reduce((s, r) => s + r.bookings.monthTarget, 0),
      unmatchedCrmRows: unmatched,
    },
  };
}
