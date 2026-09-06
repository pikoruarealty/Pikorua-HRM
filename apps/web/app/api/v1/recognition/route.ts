import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { uuidFilter } from "@/lib/api/params";
import { RecognitionPeriodType } from "@prisma/client";
import type { CompositeResult } from "@/lib/performance/composite";

// Track B. GET /api/v1/recognition — Milestone 3.1.
// Leaderboard view. Filters: period_type (weekly/monthly, default monthly),
// department_id (optional, Admin/HR only — see below).
//
// 2026-08-08 (Pillar 6): monthly rows now carry `components` — the weighted
// breakdown behind the composite score. Note what this means — the
// breakdown includes an attendance percentage and a Lead's quality rating,
// so BEFORE raising the weight of any genuinely private input (salary, a
// written review note), this route needs narrowing further. Only the
// numeric rating ever leaves this route; PerformanceReview.note is never
// included.
//
// 2026-09-06 (owner request): the leaderboard is no longer public to every
// authenticated user. Admin/HR (FINANCE_ROLES) still see every department's
// board, always, for the latest computed period, regardless of publish
// state — they manage it. Everyone else sees ONLY their own department, and
// only once an Admin has explicitly published that department's leaderboard
// for the current period via POST /recognition/leaderboard-publish; before
// that, they get an empty leaderboard rather than a 403, matching the old
// "no snapshot yet" shape. A `department_id` filter is rejected for a
// non-privileged caller unless it names their own department.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const url = new URL(req.url);
  const periodTypeParam = url.searchParams.get("period_type") ?? RecognitionPeriodType.monthly;
  // `?department_id=xyz` used to reach Prisma as a non-uuid and throw a bare
  // 500 (P2023). Same rule as everywhere else: reject, never silently drop.
  const departmentIdFilter = uuidFilter(url.searchParams.get("department_id"));
  if (departmentIdFilter === null) {
    return failFor(ErrorCode.VALIDATION, "department_id must be a uuid.");
  }
  let departmentId = departmentIdFilter;

  if (!Object.values(RecognitionPeriodType).includes(periodTypeParam as RecognitionPeriodType)) {
    return failFor(ErrorCode.VALIDATION, "period_type must be 'weekly' or 'monthly'.");
  }
  const periodType = periodTypeParam as RecognitionPeriodType;

  const isPrivileged = FINANCE_ROLES.includes(session.role);
  let periodStart: Date | null;

  if (isPrivileged) {
    const latest = await prisma.recognitionSnapshot.aggregate({
      where: { periodType, ...(departmentId ? { departmentId } : {}) },
      _max: { periodStart: true },
    });
    periodStart = latest._max.periodStart;
  } else {
    const viewer = session.employeeId
      ? await prisma.employee.findUnique({
          where: { id: session.employeeId },
          select: { departmentId: true },
        })
      : null;
    const ownDepartmentId = viewer?.departmentId ?? null;
    if (!ownDepartmentId) {
      return ok({ periodType, periodStart: null, leaderboard: [] });
    }
    if (departmentId && departmentId !== ownDepartmentId) {
      return failFor(ErrorCode.FORBIDDEN);
    }
    departmentId = ownDepartmentId;

    const latestPublished = await prisma.recognitionLeaderboardPublish.aggregate({
      where: { periodType, departmentId },
      _max: { periodStart: true },
    });
    periodStart = latestPublished._max.periodStart;
  }

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

  // A non-privileged caller only ever reaches here for their own already-
  // published department, so every row is published by construction. For a
  // privileged caller (who bypasses the publish gate above), look up which
  // of the departments in this result are actually published so the admin
  // UI can show "Publish" vs "Published" per department.
  const publishedDeptIds = isPrivileged
    ? new Set(
        (
          await prisma.recognitionLeaderboardPublish.findMany({
            where: {
              periodType,
              periodStart,
              departmentId: { in: [...new Set(snapshots.map((s) => s.departmentId))] },
            },
            select: { departmentId: true },
          })
        ).map((p) => p.departmentId),
      )
    : new Set(snapshots.map((s) => s.departmentId));

  const leaderboard = snapshots.map((s) => ({
    employeeId: s.employeeId,
    employeeName: s.employee.fullName,
    departmentId: s.departmentId,
    departmentName: s.department.name,
    score: Number(s.score),
    rank: s.rank,
    isEmployeeOfMonth: s.isEmployeeOfMonth,
    // Null on weekly snapshots and on rows computed before Pillar 6 — the UI
    // falls back to showing the bare score in both cases.
    components: (s.components as CompositeResult | null) ?? null,
    isPublished: publishedDeptIds.has(s.departmentId),
  }));

  return ok({ periodType, periodStart, leaderboard });
}
