import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { isUuid } from "@/lib/api/params";
import { getLedEmployeeIds } from "@/lib/employees/managed-scope";
import { getWfhPlan } from "@/lib/attendance/wfh-hours";
import { ATTENDANCE_EXEMPT_MESSAGE, isAttendanceExemptRole } from "@/lib/attendance/tracking";

// GET /api/v1/attendance/:employee_id/wfh-hours (2026-09-30) — the employee's
// weekly WFH-hours target and running advance/late balance
// (lib/attendance/wfh-hours.ts). Same audience as the attendance summary:
// Admin/HR, the owning Lead, the employee. `{ enabled: false }` when Admin hasn't
// set a target. Tracking only — nothing here feeds payroll.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!isUuid(params.id)) return failFor(ErrorCode.NOT_FOUND);

  const isFinance = FINANCE_ROLES.includes(session.role);
  const isSelf = session.employeeId === params.id;
  let isOwnTeamLead = false;
  if (!isFinance && !isSelf && isLeadRole(session.role) && session.employeeId) {
    isOwnTeamLead = (await getLedEmployeeIds(session.employeeId)).includes(params.id);
  }
  if (!isFinance && !isSelf && !isOwnTeamLead) return failFor(ErrorCode.FORBIDDEN);

  const employee = await prisma.employee.findUnique({ where: { id: params.id }, select: { role: true } });
  if (!employee) return failFor(ErrorCode.NOT_FOUND, "Employee not found.");
  if (isAttendanceExemptRole(employee.role)) return failFor(ErrorCode.NOT_FOUND, ATTENDANCE_EXEMPT_MESSAGE);

  return ok(await getWfhPlan(params.id));
}
