import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { getLeaveBalance } from "@/lib/leave/balance";

// Owner request, 2026-08-07. GET /api/v1/leave-config/balance?employee_id=&month=&year=
// — an employee sees their own balance; Admin/HR can query anyone. Defaults
// to the current month/year and the caller's own employee_id if omitted.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const { searchParams } = new URL(req.url);
  const now = new Date();
  const month = Number(searchParams.get("month") ?? now.getMonth() + 1);
  const year = Number(searchParams.get("year") ?? now.getFullYear());
  const requestedEmployeeId = searchParams.get("employee_id") ?? session.employeeId ?? undefined;

  if (!requestedEmployeeId) return failFor(ErrorCode.NOT_FOUND, "No employee to report a balance for.");

  const isFinance = FINANCE_ROLES.includes(session.role);
  if (!isFinance && requestedEmployeeId !== session.employeeId) {
    return failFor(ErrorCode.FORBIDDEN);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) {
    return failFor(ErrorCode.VALIDATION, "month must be 1-12 and year must be an integer.");
  }

  const employee = await prisma.employee.findUnique({
    where: { id: requestedEmployeeId },
    select: { id: true, fullName: true, dateOfJoining: true, employmentType: true },
  });
  if (!employee) return failFor(ErrorCode.NOT_FOUND, "Employee not found.");

  const balance = await getLeaveBalance(
    requestedEmployeeId,
    month,
    year,
    employee.dateOfJoining,
    employee.employmentType,
  );
  return ok({
    employeeId: employee.id,
    fullName: employee.fullName,
    dateOfJoining: employee.dateOfJoining,
    employmentType: employee.employmentType,
    periodMonth: month,
    periodYear: year,
    ...balance,
  });
}
