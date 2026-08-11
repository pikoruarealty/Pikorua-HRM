import { prisma } from "@/lib/db/prisma";
import {
  expectedWorkingDaysInMonth,
  getMonthlyAttendanceBreakdownForAllEmployees,
} from "@/lib/attendance/monthly-breakdown";
import type { MonthlyBreakdown } from "@/lib/attendance/monthly-breakdown";
import {
  addDays,
  buildMovedOffDateByWeek,
  resolveDefaultOffDay,
  weekStartOf,
} from "@/lib/attendance/week";
import {
  attendanceToScore,
  computeComposite,
  profileFor,
  ratingToScore,
  ratioToScore,
  relativeToBest,
  type ComponentInput,
  type ComponentKey,
  type CompositeResult,
} from "@/lib/performance/composite";
import { getPerformanceConfig } from "@/lib/performance/config";
import { cappedSelfLoggedPoints } from "@/lib/work/adhoc";
import { expectedActivityDaysElapsed } from "@/lib/sales/pacing";
import {
  attainmentFor,
  summariseMetricItems,
  type SalesAttainment,
} from "@/lib/sales/monthly-attainment";

// Pillar 6 (2026-08-08) — the DB half of the composite monthly score. The
// weighting maths lives in ./composite.ts (pure, unit-tested); this file only
// gathers raw inputs and hands them over.
//
// Everything is fetched ORG-WIDE in one pass (six queries total, regardless of
// department or headcount) because computeAndReplace loops over departments and
// a per-department fetch would be 6*N round-trips. The recognition cron already
// runs weekly + monthly for every department, so this matters.

export type EmployeeRawInputs = {
  /**
   * Verified task points credited in the period (Atomic/Tech), AFTER the
   * self-logged cap has been applied — see `performance_config.
   * self_logged_cap_percent`. This is the number the Output component is built
   * from, so the cap has to bite here rather than at approval time: refusing to
   * credit work that genuinely happened would be a lie about the work.
   */
  points: number;
  /** Points that were credited but excluded from `points` by the cap. */
  selfLoggedExcluded: number;
  /** Sales metric attainment, split per metric. Null for non-sales employees. */
  sales: SalesAttainment | null;
  /** Average Lead review rating 1-5, or null when unreviewed. */
  reviewAvg: number | null;
  attendance: MonthlyBreakdown | null;
  /** Due-dated tasks completed in the period, and how many of those were on time. */
  timeliness: { onTime: number; total: number };
  /** Distinct tasks committed to in Daily Planning, and how many reached completed. */
  adherence: { completed: number; total: number };
};

export type MonthlyInputs = Map<string, EmployeeRawInputs>;

function blank(): EmployeeRawInputs {
  return {
    points: 0,
    selfLoggedExcluded: 0,
    sales: null,
    reviewAvg: null,
    attendance: null,
    timeliness: { onTime: 0, total: 0 },
    adherence: { completed: 0, total: 0 },
  };
}

function entry(map: MonthlyInputs, employeeId: string): EmployeeRawInputs {
  let e = map.get(employeeId);
  if (!e) {
    e = blank();
    map.set(employeeId, e);
  }
  return e;
}

/** UTC calendar day of an instant, as a comparable epoch — due dates are date-only. */
function utcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Gather every composite input for one month, for every active employee.
 * `periodEnd` is exclusive.
 */
export async function gatherMonthlyInputs(
  periodStart: Date,
  periodEnd: Date,
): Promise<MonthlyInputs> {
  const month = periodStart.getUTCMonth() + 1;
  const year = periodStart.getUTCFullYear();
  const inputs: MonthlyInputs = new Map();

  const [
    ledger,
    selfLoggedLedger,
    metricItems,
    reviews,
    attendance,
    dueDated,
    selections,
    perfConfig,
    calendar,
  ] = await Promise.all([
    // Deleting a WorkItem deliberately leaves its ledger row in place (see the
    // DELETE handler in work-items/[id]) so the credit stays auditable. That
    // makes it this reader's job to exclude it: without the join a task a Lead
    // deleted as a mistake keeps propping up its author's Output score forever,
    // and no amount of correcting the work undoes it.
    prisma.employeePointLedger.groupBy({
      by: ["employeeId"],
      where: {
        creditedAt: { gte: periodStart, lt: periodEnd },
        workItem: { deletedAt: null },
      },
      _sum: { points: true },
    }),
    // The self-logged slice of the same window, so the cap can be applied
    // org-wide in one pass rather than per-employee (monthlyPointSplit does the
    // same split for a single employee, for the profile screen).
    prisma.employeePointLedger.groupBy({
      by: ["employeeId"],
      where: {
        creditedAt: { gte: periodStart, lt: periodEnd },
        workItem: { deletedAt: null, selfLogged: true },
      },
      _sum: { points: true },
    }),
    prisma.workItem.findMany({
      where: {
        mode: "metric",
        periodMonth: month,
        periodYear: year,
        deletedAt: null,
      },
      select: {
        assignedTo: true,
        salesMetric: true,
        targetValue: true,
        currentValue: true,
      },
    }),
    prisma.performanceReview.groupBy({
      by: ["employeeId"],
      where: { periodYear: year, periodMonth: month },
      _avg: { rating: true },
    }),
    getMonthlyAttendanceBreakdownForAllEmployees(month, year),
    prisma.workItem.findMany({
      where: {
        deletedAt: null,
        dueDate: { not: null },
        completedAt: { gte: periodStart, lt: periodEnd },
      },
      select: { assignedTo: true, dueDate: true, completedAt: true },
    }),
    // Commitment adherence. The plan originally specified a strict same-day
    // join (selected on day D and completed on day D); that would score a
    // well-run five-day task as four broken commitments, which directly fights
    // Pillar 2's push toward larger, verified tasks. So this measures DISTINCT
    // tasks committed to during the period that actually reached completed —
    // "did what you signed up for land?" rather than "did it land today?".
    prisma.dailyTaskSelection.findMany({
      where: { date: { gte: periodStart, lt: periodEnd } },
      select: {
        employeeId: true,
        workItemId: true,
        workItem: { select: { completedAt: true, deletedAt: true } },
      },
    }),
    getPerformanceConfig(periodStart),
    // The month's off-day + holiday calendar, needed to pro-rate monthly sales
    // targets against the days a rep was actually expected to be selling.
    // Fetched org-wide alongside everything else rather than per-department.
    (async () => {
      const [employees, holidays, moves] = await Promise.all([
        prisma.employee.findMany({
          where: { status: "active" },
          select: {
            id: true,
            defaultWeeklyOffDay: true,
            team: { select: { defaultWeeklyOffDay: true } },
          },
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
      return { employees, holidays, moves };
    })(),
  ]);

  const selfLoggedByEmployee = new Map(
    selfLoggedLedger.map((r) => [r.employeeId, r._sum.points ?? 0]),
  );
  for (const row of ledger) {
    const totalPoints = row._sum.points ?? 0;
    const { allowed, excluded } = cappedSelfLoggedPoints({
      selfLoggedPoints: selfLoggedByEmployee.get(row.employeeId) ?? 0,
      totalPoints,
      capPercent: perfConfig.selfLoggedCapPercent,
    });
    const e = entry(inputs, row.employeeId);
    // total - selfLogged is the assigned half, which is never capped.
    e.points = totalPoints - (selfLoggedByEmployee.get(row.employeeId) ?? 0) + allowed;
    e.selfLoggedExcluded = excluded;
  }

  for (const row of reviews) {
    entry(inputs, row.employeeId).reviewAvg = row._avg.rating ?? null;
  }

  for (const row of attendance) {
    entry(inputs, row.employeeId).attendance = row;
  }

  // Sales attainment, per metric rather than averaged across every metric row.
  // Site-visit and booking targets are whole-month figures, so they are
  // pro-rated against the days this rep was expected to be selling — otherwise
  // every rep in the org reads as a failure until the last week of the month.
  const holidayDates = new Set(calendar.holidays.map((h) => h.date.toISOString().slice(0, 10)));
  const movesByEmployee = new Map<string, { weekStart: Date; date: Date }[]>();
  for (const m of calendar.moves) {
    const list = movesByEmployee.get(m.employeeId);
    if (list) list.push(m);
    else movesByEmployee.set(m.employeeId, [m]);
  }
  const metricTotals = summariseMetricItems(metricItems);
  for (const emp of calendar.employees) {
    const totals = metricTotals.get(emp.id);
    if (!totals) continue;
    const movedOffDateByWeek = buildMovedOffDateByWeek(movesByEmployee.get(emp.id) ?? []);
    const defaultOffDay = resolveDefaultOffDay(
      emp.defaultWeeklyOffDay,
      emp.team?.defaultWeeklyOffDay,
    );
    const expectedDaysInMonth = expectedWorkingDaysInMonth(month, year, {
      holidayDates,
      defaultOffDay,
      movedOffDateByWeek,
    });
    const breakdown = entry(inputs, emp.id).attendance;
    const expectedDaysElapsed = breakdown ? expectedActivityDaysElapsed(breakdown) : 0;
    entry(inputs, emp.id).sales = attainmentFor(totals, expectedDaysElapsed, expectedDaysInMonth);
  }

  for (const item of dueDated) {
    if (!item.dueDate || !item.completedAt) continue;
    const t = entry(inputs, item.assignedTo).timeliness;
    t.total += 1;
    if (utcDay(item.completedAt) <= utcDay(item.dueDate)) t.onTime += 1;
  }

  // A task selected on several days is one commitment, not several.
  const seen = new Set<string>();
  for (const sel of selections) {
    if (sel.workItem.deletedAt) continue;
    const key = `${sel.employeeId}:${sel.workItemId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const a = entry(inputs, sel.employeeId).adherence;
    a.total += 1;
    if (sel.workItem.completedAt && sel.workItem.completedAt < periodEnd) a.completed += 1;
  }

  return inputs;
}

/** The department-relative ceiling the `output` component is measured against. */
export type DepartmentBest = { bestPoints: number };

export function departmentBest(
  employeeIds: string[],
  inputs: MonthlyInputs,
): DepartmentBest {
  let bestPoints = 0;
  for (const id of employeeIds) {
    const raw = inputs.get(id);
    if (raw && raw.points > bestPoints) bestPoints = raw.points;
  }
  return { bestPoints };
}

/**
 * Turn one employee's raw inputs into a composite score.
 *
 * `isMetricDepartment` selects both the weight profile and how "output" is
 * measured. Tech earns discrete task points, compared against the department's
 * top scorer since a raw point total means nothing in isolation, and output
 * carries 50 of the 100 nominal weight.
 *
 * Sales splits that same 50 across the three metrics in the owner's locked
 * 3:5:7 ratio, using two slots: `output` carries calls (10) and `salesOutcome`
 * carries site visits + bookings blended (40). Each is an absolute 0-100
 * attainment against a paced target, so no department-relative ceiling is
 * needed — and unlike the old flat average across every metric row, a rep can
 * no longer top the department on dialling alone.
 */
export function scoreEmployee(
  employeeId: string,
  inputs: MonthlyInputs,
  best: DepartmentBest,
  isMetricDepartment: boolean,
): CompositeResult {
  const raw = inputs.get(employeeId) ?? blank();
  const components: Partial<Record<ComponentKey, ComponentInput>> = {};

  if (isMetricDepartment) {
    components.output = {
      value: raw.sales?.callsPct ?? null,
      detail: raw.sales?.callsDetail ?? undefined,
    };
    components.salesOutcome = {
      value: raw.sales?.outcomePct ?? null,
      detail: raw.sales?.outcomeDetail ?? undefined,
    };
  } else {
    components.output = {
      value: relativeToBest(raw.points, best.bestPoints),
      detail:
        best.bestPoints > 0
          ? `${raw.points} of ${best.bestPoints} pts${
              raw.selfLoggedExcluded > 0 ? ` (${raw.selfLoggedExcluded} over self-logged cap)` : ""
            }`
          : undefined,
    };
  }

  components.quality = {
    value: ratingToScore(raw.reviewAvg),
    detail: raw.reviewAvg === null ? undefined : `${raw.reviewAvg.toFixed(1)} / 5 rating`,
  };

  components.attendance = raw.attendance
    ? {
        value: attendanceToScore(raw.attendance),
        detail: `${raw.attendance.presentDays + raw.attendance.halfDays * 0.5} of ${raw.attendance.workingDaysElapsed} days`,
      }
    : { value: null };

  components.timeliness = {
    value: ratioToScore(raw.timeliness.onTime, raw.timeliness.total),
    detail:
      raw.timeliness.total > 0
        ? `${raw.timeliness.onTime} of ${raw.timeliness.total} on time`
        : undefined,
  };

  components.adherence = {
    value: ratioToScore(raw.adherence.completed, raw.adherence.total),
    detail:
      raw.adherence.total > 0
        ? `${raw.adherence.completed} of ${raw.adherence.total} completed`
        : undefined,
  };

  return computeComposite(components, profileFor(isMetricDepartment));
}
