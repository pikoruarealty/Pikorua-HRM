import { prisma } from "@/lib/db/prisma";
import { RecognitionPeriodType, EmployeeStatus } from "@prisma/client";
import { notifyAllActiveUsers } from "@/lib/notifications/push";

// Track B — Milestone 3.1 core logic, extracted from the cron route so both
// the CRON_SECRET-gated HTTP route AND the in-process scheduler
// (instrumentation.ts) can invoke it without going through HTTP. Behavior is
// unchanged from the original route: Tech scores off point-ledger, Sales/BD off
// metric achieved-%, idempotent per (period_type, period_start), single winner
// (rank 1, score > 0) gets is_employee_of_month for monthly periods.

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
    rank: number;
    isEmployeeOfMonth: boolean;
  }[] = [];

  for (const dept of departments) {
    if (dept.employees.length === 0) continue;

    const scored: { employeeId: string; score: number }[] = [];

    if (dept.typeKey === "tech") {
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
        const pct = target > 0 ? (current / target) * 100 : 0;
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
        rank,
        isEmployeeOfMonth:
          periodType === RecognitionPeriodType.monthly && rank === 1 && s.score > 0,
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
