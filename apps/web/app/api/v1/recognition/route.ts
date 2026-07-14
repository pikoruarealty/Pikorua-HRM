import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { RecognitionPeriodType } from "@prisma/client";

// Track B. GET /api/v1/recognition — Milestone 3.1.
// Leaderboard view. RBAC: Any authenticated user. Filters: period_type
// (weekly/monthly, default monthly), department_id (optional). If
// period_start isn't given, uses the most recently computed period for the
// matching filters (the latest snapshot job's run).

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const url = new URL(req.url);
  const periodTypeParam = url.searchParams.get("period_type") ?? RecognitionPeriodType.monthly;
  const departmentId = url.searchParams.get("department_id") ?? undefined;

  if (!Object.values(RecognitionPeriodType).includes(periodTypeParam as RecognitionPeriodType)) {
    return failFor(ErrorCode.VALIDATION, "period_type must be 'weekly' or 'monthly'.");
  }
  const periodType = periodTypeParam as RecognitionPeriodType;

  const latest = await prisma.recognitionSnapshot.aggregate({
    where: { periodType, ...(departmentId ? { departmentId } : {}) },
    _max: { periodStart: true },
  });
  const periodStart = latest._max.periodStart;
  if (!periodStart) {
    return ok({ periodType, periodStart: null, leaderboard: [] });
  }

  const snapshots = await prisma.recognitionSnapshot.findMany({
    where: { periodType, periodStart, ...(departmentId ? { departmentId } : {}) },
    include: {
      employee: { select: { id: true, fullName: true } },
      department: { select: { id: true, name: true } },
    },
    orderBy: [{ departmentId: "asc" }, { rank: "asc" }],
  });

  const leaderboard = snapshots.map((s) => ({
    employeeId: s.employeeId,
    employeeName: s.employee.fullName,
    departmentId: s.departmentId,
    departmentName: s.department.name,
    score: Number(s.score),
    rank: s.rank,
    isEmployeeOfMonth: s.isEmployeeOfMonth,
  }));

  return ok({ periodType, periodStart, leaderboard });
}
