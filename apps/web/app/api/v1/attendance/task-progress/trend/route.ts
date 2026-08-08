import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { todayDateOnly } from "@/lib/attendance/time";
import { buildTeamTodaySummary } from "@/lib/eod/team-today";
import { EmployeeStatus } from "@prisma/client";

// Track A (owner request, 2026-08-07). GET /api/v1/attendance/task-progress/trend
// — Admin/HR only. 7-day company-wide task completion trend for the admin
// dashboard chart. Loops buildTeamTodaySummary() (direct import, not HTTP)
// once per day — cheap at this scale (active headcount x 7), no new schema.
export async function GET() {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!FINANCE_ROLES.includes(session.role)) return failFor(ErrorCode.FORBIDDEN);

  // Admin does not clock in or track tasks, so they are excluded from the trend.
  const active = await prisma.employee.findMany({
    where: {
      status: EmployeeStatus.active,
      role: { not: "admin" },
    },
    select: { id: true },
  });
  const employeeIds = active.map((e) => e.id);

  const today = todayDateOnly();
  const days: Date[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    days.push(d);
  }

  const trend = await Promise.all(
    days.map(async (d) => {
      const rows = employeeIds.length ? await buildTeamTodaySummary(employeeIds, d) : [];
      const planned = rows.reduce((sum, r) => sum + r.plannedCount, 0);
      const completed = rows.reduce((sum, r) => sum + r.completedCount, 0);
      return { date: d.toISOString().slice(0, 10), planned, completed };
    }),
  );

  return ok({ trend });
}
