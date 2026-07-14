import { prisma } from "@/lib/db/prisma";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { RecognitionPeriodType, EmployeeStatus } from "@prisma/client";

// Track B. POST /api/v1/cron/recognition-snapshot — Milestone 3.1.
// Cron-triggered job (checks CRON_SECRET, not a user session) that (re)computes
// `recognition_snapshots` for a weekly and/or monthly period. Tech departments
// score off `employee_point_ledger` (atomic task points credited in-period);
// Sales/BD departments score off metric WorkItems' achieved-% for the period's
// month (PRD §5.8, SCHEMA.md `recognition_snapshots`). Re-running for the same
// (period_type, period_start) is idempotent — existing rows for that period are
// replaced, not appended to.
//
// Assumption (PRD §7 open question #3 unresolved): single winner per
// department — `rank = 1` gets `is_employee_of_month`, and only if their score
// is > 0 (a department with zero activity has no winner that period).

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

async function computeAndReplace(periodType: RecognitionPeriodType, periodStart: Date) {
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

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return failFor(ErrorCode.UNAUTHENTICATED, "Invalid or missing cron secret.");
  }

  const url = new URL(req.url);
  const periodTypeParam = url.searchParams.get("period_type");
  const periodStartParam = url.searchParams.get("period_start");
  const now = new Date();

  const results: { periodType: RecognitionPeriodType; periodStart: string; rowsWritten: number }[] = [];

  const types: RecognitionPeriodType[] = periodTypeParam
    ? [periodTypeParam as RecognitionPeriodType]
    : [RecognitionPeriodType.weekly, RecognitionPeriodType.monthly];

  if (periodTypeParam && !Object.values(RecognitionPeriodType).includes(periodTypeParam as RecognitionPeriodType)) {
    return failFor(ErrorCode.VALIDATION, "period_type must be 'weekly' or 'monthly'.");
  }

  for (const periodType of types) {
    let periodStart: Date;
    if (periodStartParam) {
      periodStart = new Date(periodStartParam);
      if (Number.isNaN(periodStart.getTime())) {
        return failFor(ErrorCode.VALIDATION, "period_start must be a valid date.");
      }
    } else {
      periodStart =
        periodType === RecognitionPeriodType.weekly ? startOfWeekUTC(now) : startOfMonthUTC(now);
    }
    const rowsWritten = await computeAndReplace(periodType, periodStart);
    results.push({ periodType, periodStart: periodStart.toISOString().slice(0, 10), rowsWritten });
  }

  return ok({ results });
}
