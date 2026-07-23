import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { todayDateOnly } from "@/lib/attendance/time";
import { getLedEmployeeIds } from "@/lib/employees/managed-scope";
import { buildTeamTodaySummary } from "@/lib/eod/team-today";
import { EmployeeStatus } from "@prisma/client";

// GET /api/v1/attendance/task-progress?date=YYYY-MM-DD — the Lead/Admin "what
// is everyone doing right now" live view: every scoped employee's clock
// status + today's task plan + live completion progress, in one call (vs.
// querying GET /attendance/eod one employee at a time). Admin/HR see the
// whole company; a Lead sees every team they lead (any number) plus self.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const isFinance = FINANCE_ROLES.includes(session.role);
  const isLead = isLeadRole(session.role);
  if (!isFinance && !isLead) return failFor(ErrorCode.FORBIDDEN);

  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date");
  let date: Date;
  if (dateParam) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return failFor(ErrorCode.VALIDATION, "date must be YYYY-MM-DD.");
    }
    date = new Date(`${dateParam}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      return failFor(ErrorCode.VALIDATION, "date is not a valid calendar date.");
    }
  } else {
    date = todayDateOnly();
  }

  let employeeIds: string[];
  if (isFinance) {
    const active = await prisma.employee.findMany({
      where: { status: EmployeeStatus.active },
      select: { id: true },
    });
    employeeIds = active.map((e) => e.id);
  } else {
    if (!session.employeeId) return ok({ date: date.toISOString().slice(0, 10), rows: [] });
    employeeIds = await getLedEmployeeIds(session.employeeId);
  }

  const rows = await buildTeamTodaySummary(employeeIds, date);
  return ok({ date: date.toISOString().slice(0, 10), rows });
}
