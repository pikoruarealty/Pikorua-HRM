import { prisma } from "@/lib/db/prisma";
import { RecognitionPeriodType, EmployeeStatus, Prisma } from "@prisma/client";
import { createLogger } from "@/lib/log";
import { notifyAllActiveUsers } from "@/lib/notifications/push";
import {
  departmentBest,
  gatherMonthlyInputs,
  scoreEmployee,
} from "@/lib/performance/monthly-score";
import { getPerformanceConfig } from "@/lib/performance/config";
import { isMetricDepartment } from "@/lib/departments/type";

const logger = createLogger("recognition-cron");

// Track B — Milestone 3.1 core logic, extracted from the cron route so both
// the CRON_SECRET-gated HTTP route AND the in-process scheduler
// (instrumentation.ts) can invoke it without going through HTTP. Tech scores
// off point-ledger, Sales/BD off metric achieved-%, idempotent per
// (period_type, period_start).
//
// 2026-08-08 (Pillar 6): MONTHLY snapshots are no longer that single signal.
// They are now a 0-100 weighted composite of output, Lead quality rating,
// attendance, timeliness and commitments kept — see lib/performance/composite.ts
// for the weights and lib/performance/monthly-score.ts for the inputs. The
// breakdown is stored alongside the score in `components` so a rank stays
// explainable later. WEEKLY is untouched and still uses the raw scoring below.
//
// 2026-08-07: this snapshot is now reference-only leaderboard data — it no
// longer sets isEmployeeOfMonth on its own. "Employee of the Week/Month" is
// now an Admin-only manual pick (POST /recognition/publish); this job just
// keeps the underlying scores/ranks fresh for the admin to pick from. A
// re-run of computeAndReplace deletes+recreates every row for the period,
// which would also wipe out a prior manual publish's isEmployeeOfMonth /
// selectedManually / publishedAt flags on that row — the publish route
// re-applies on top of whatever the latest snapshot looks like, so always
// recompute BEFORE publishing, not after.

function startOfWeekUTC(d: Date): Date {
  const day = d.getUTCDay();
  const diff = (day === 0 ? -6 : 1) - day;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
}

function startOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function periodEnd(periodType: RecognitionPeriodType, periodStart: Date): Date {
  if (periodType === RecognitionPeriodType.weekly) {
    return new Date(periodStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  }
  return new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 1));
}

export async function computeAndReplace(
  periodType: RecognitionPeriodType,
  periodStart: Date,
): Promise<number> {
  const end = periodEnd(periodType, periodStart);

  // Grace period (2026-08-11): until an Admin flips performance_config
  // .scoring_enabled on, no composite score is published. Tasks, attendance
  // and sales numbers are all still recorded — this gates publication only.
  // The check is versioned by periodStart, so switching scoring on in
  // September does not retroactively publish August's ranks.
  //
  // Existing rows for the period are left alone rather than deleted: a period
  // scored before the switch was turned off stays readable, and re-enabling
  // scoring recomputes it. Weekly is not gated — it is raw point totals, not
  // the composite, and it is what a Lead uses day to day.
  if (periodType === RecognitionPeriodType.monthly) {
    const perfConfig = await getPerformanceConfig(periodStart);
    if (!perfConfig.scoringEnabled) {
      logger.info("monthly recognition skipped — scoring is disabled for this period", {
        periodStart: periodStart.toISOString().slice(0, 10),
      });
      return 0;
    }
  }

  const targetMonth = periodStart.getUTCMonth() + 1;
  const targetYear = periodStart.getUTCFullYear();

  const departments = await prisma.department.findMany({
    include: {
      employees: { where: { status: EmployeeStatus.active } },
    },
  });

  const rows: {
    periodType: RecognitionPeriodType;
    periodStart: Date;
    departmentId: string;
    employeeId: string;
    score: number;
    components?: Prisma.InputJsonValue;
    rank: number;
    isEmployeeOfMonth: boolean;
  }[] = [];

  // Monthly is a composite of output + quality + attendance + timeliness +
  // commitments kept (Pillar 6). Weekly deliberately stays on the original raw
  // single-signal scoring: monthly attendance and a monthly quality review say
  // nothing meaningful about a 7-day window.
  const isMonthly = periodType === RecognitionPeriodType.monthly;
  const monthlyInputs = isMonthly ? await gatherMonthlyInputs(periodStart, end) : null;

  for (const dept of departments) {
    if (dept.employees.length === 0) continue;

    const scored: { employeeId: string; score: number; components?: Prisma.InputJsonValue }[] = [];

    if (monthlyInputs) {
      const employeeIds = dept.employees.map((e) => e.id);
      const best = departmentBest(employeeIds, monthlyInputs);
      for (const emp of dept.employees) {
        const result = scoreEmployee(emp.id, monthlyInputs, best, isMetricDepartment(dept.typeKey));
        scored.push({
          employeeId: emp.id,
          score: result.score,
          components: result as unknown as Prisma.InputJsonValue,
        });
      }
    } else if (dept.typeKey === "tech") {
      const ledgerSums = await prisma.employeePointLedger.groupBy({
        by: ["employeeId"],
        where: {
          employeeId: { in: dept.employees.map((e) => e.id) },
          creditedAt: { gte: periodStart, lt: end },
        },
        _sum: { points: true },
      });
      const byEmployee = new Map(ledgerSums.map((r) => [r.employeeId, r._sum.points ?? 0]));
      for (const emp of dept.employees) {
        scored.push({ employeeId: emp.id, score: byEmployee.get(emp.id) ?? 0 });
      }
    } else {
      const metricItems = await prisma.workItem.findMany({
        where: {
          assignedTo: { in: dept.employees.map((e) => e.id) },
          mode: "metric",
          periodMonth: targetMonth,
          periodYear: targetYear,
          deletedAt: null,
        },
        select: { assignedTo: true, targetValue: true, currentValue: true },
      });
      const byEmployee = new Map<string, number[]>();
      for (const item of metricItems) {
        const target = Number(item.targetValue ?? 0);
        const current = Number(item.currentValue ?? 0);
        // A target of 0 means nobody set one, which is not 0% attainment —
        // scoring it as such dragged the whole average down for a rep whose
        // targets simply hadn't been provisioned yet. Skipped instead.
        if (!(target > 0)) continue;
        const pct = (current / target) * 100;
        const list = byEmployee.get(item.assignedTo) ?? [];
        list.push(pct);
        byEmployee.set(item.assignedTo, list);
      }
      for (const emp of dept.employees) {
        const pcts = byEmployee.get(emp.id) ?? [];
        const avg = pcts.length > 0 ? pcts.reduce((a, b) => a + b, 0) / pcts.length : 0;
        scored.push({ employeeId: emp.id, score: avg });
      }
    }

    scored.sort((a, b) => b.score - a.score || a.employeeId.localeCompare(b.employeeId));

    scored.forEach((s, idx) => {
      const rank = idx + 1;
      rows.push({
        periodType,
        periodStart,
        departmentId: dept.id,
        employeeId: s.employeeId,
        score: s.score,
        ...(s.components === undefined ? {} : { components: s.components }),
        rank,
        // No longer auto-set — see the file-header note. Admin picks and
        // publishes the winner via POST /recognition/publish.
        isEmployeeOfMonth: false,
      });
    });
  }

  await prisma.$transaction([
    prisma.recognitionSnapshot.deleteMany({ where: { periodType, periodStart } }),
    prisma.recognitionSnapshot.createMany({ data: rows }),
  ]);

  return rows.length;
}

/**
 * Run the recognition snapshot for the given period types (default: both
 * weekly + monthly), keyed to `now` unless an explicit periodStart is given.
 */
export async function runRecognitionSnapshot(opts?: {
  periodType?: RecognitionPeriodType;
  periodStart?: Date;
  now?: Date;
}): Promise<{ periodType: RecognitionPeriodType; periodStart: string; rowsWritten: number }[]> {
  const now = opts?.now ?? new Date();
  const types: RecognitionPeriodType[] = opts?.periodType
    ? [opts.periodType]
    : [RecognitionPeriodType.weekly, RecognitionPeriodType.monthly];

  const results: { periodType: RecognitionPeriodType; periodStart: string; rowsWritten: number }[] = [];
  for (const periodType of types) {
    const periodStart =
      opts?.periodStart ??
      (periodType === RecognitionPeriodType.weekly ? startOfWeekUTC(now) : startOfMonthUTC(now));
    const rowsWritten = await computeAndReplace(periodType, periodStart);
    if (rowsWritten > 0) {
      const label = periodType === RecognitionPeriodType.weekly ? "This week's" : "This month's";
      await notifyAllActiveUsers(
        "recognition_snapshot",
        `${label} recognition results are in — check the leaderboard.`,
        "Recognition update",
      );
    }
    results.push({ periodType, periodStart: periodStart.toISOString().slice(0, 10), rowsWritten });
  }
  return results;
}
