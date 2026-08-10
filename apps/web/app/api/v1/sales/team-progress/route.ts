import { getSession } from "@/lib/auth";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { todayDateOnly } from "@/lib/attendance/time";
import { resolveSalesScope, scopeToEmployeeIds } from "@/lib/sales/authority";
import { buildSalesTeamProgress } from "@/lib/sales/team-progress";

// GET /api/v1/sales/team-progress?date=YYYY-MM-DD — Pillar 5 (2026-08-10).
//
// The sales counterpart to GET /attendance/task-progress: today's calls vs.
// target and the month's site visits / bookings vs. pro-rated target, per rep,
// with team totals. Same RBAC shape as its Tech sibling — Admin/HR see the
// whole company, a Lead sees every team they lead plus themselves.
//
// An ordinary rep hitting this sees only their own row. That is deliberate:
// this is an operational management view, and the plan's decision #4 narrowed
// performance visibility to self + owning Lead + Admin/HR.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const scope = await resolveSalesScope(session);
  if (!scope) return failFor(ErrorCode.FORBIDDEN, "No employee record linked to this account.");

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

  const employeeIds = await scopeToEmployeeIds(scope);
  return ok(await buildSalesTeamProgress(employeeIds, date));
}
