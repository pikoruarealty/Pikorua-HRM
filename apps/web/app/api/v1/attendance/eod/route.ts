import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { buildEodSummary } from "@/lib/eod/summary";
import { getLedEmployeeIds } from "@/lib/employees/managed-scope";

// Track A. GET /api/v1/attendance/eod?date=YYYY-MM-DD&employee_id=
// Derived End-of-Day summary (PRD §5.4) for the Daily Planning screen.
// Self by default; Admin/HR (any) and a Lead (own team) may pass employee_id.
// `date` defaults to today (server-local, UTC-midnight aligned to @db.Date).
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!session.employeeId) {
    return failFor(ErrorCode.FORBIDDEN, "No employee record linked to this account.");
  }

  const { searchParams } = new URL(req.url);
  const employeeId = searchParams.get("employee_id") ?? session.employeeId;

  const isFinance = FINANCE_ROLES.includes(session.role);
  const isSelf = employeeId === session.employeeId;
  // "Own team" means every team this Lead leads, not the one they belong to.
  let isOwnTeamLead = false;
  if (!isFinance && !isSelf && isLeadRole(session.role)) {
    const ledIds = await getLedEmployeeIds(session.employeeId);
    isOwnTeamLead = ledIds.includes(employeeId);
  }
  if (!isFinance && !isSelf && !isOwnTeamLead) {
    return failFor(ErrorCode.FORBIDDEN);
  }

  const dateParam = searchParams.get("date");
  let date: Date;
  if (dateParam) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return failFor(ErrorCode.VALIDATION, "date must be YYYY-MM-DD.");
    }
    date = new Date(`${dateParam}T00:00:00.000Z`);
  } else {
    date = new Date(new Date().toISOString().slice(0, 10));
  }

  const eod = await buildEodSummary(employeeId, date);
  return ok(eod);
}
