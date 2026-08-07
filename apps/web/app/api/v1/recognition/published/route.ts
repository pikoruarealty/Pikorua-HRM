import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { ok, failFor, ErrorCode } from "@/lib/api/response";

// Track B (owner request, 2026-08-07). GET /api/v1/recognition/published —
// any authenticated user. Returns the currently "fresh" published
// Employee-of-the-Week/Month picks (publishedAt within the last ~24h),
// across all departments/period types — feeds the dashboard banner.
// Uses the recognition_snapshots(is_employee_of_month, published_at) index.

const WINDOW_MS = 24 * 60 * 60 * 1000;

export async function GET() {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const since = new Date(Date.now() - WINDOW_MS);

  const picks = await prisma.recognitionSnapshot.findMany({
    where: { isEmployeeOfMonth: true, publishedAt: { gte: since } },
    include: {
      employee: { select: { id: true, fullName: true } },
      department: { select: { id: true, name: true } },
    },
    orderBy: { publishedAt: "desc" },
  });

  return ok(
    picks.map((p) => ({
      id: p.id,
      periodType: p.periodType,
      periodStart: p.periodStart,
      employeeId: p.employeeId,
      employeeName: p.employee.fullName,
      departmentId: p.departmentId,
      departmentName: p.department.name,
      publishedAt: p.publishedAt,
    })),
  );
}
