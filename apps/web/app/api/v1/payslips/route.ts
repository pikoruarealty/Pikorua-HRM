import { Prisma, PayslipStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";

// Track A. GET /api/v1/payslips — Admin/HR see all (filterable), Employee
// sees only their own **finalized** payslips (drafts must never be visible
// to the employee — API_SPEC.md §6 / golden RBAC rule). Filters: employee_id,
// month, year.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return failFor(ErrorCode.UNAUTHENTICATED);
  }

  const { searchParams } = new URL(req.url);
  const employeeIdParam = searchParams.get("employee_id") ?? undefined;
  const monthParam = searchParams.get("month");
  const yearParam = searchParams.get("year");

  const where: Prisma.PayslipWhereInput = {};
  if (monthParam) where.periodMonth = Number(monthParam);
  if (yearParam) where.periodYear = Number(yearParam);

  if (FINANCE_ROLES.includes(session.role)) {
    if (employeeIdParam) where.employeeId = employeeIdParam;
  } else {
    if (!session.employeeId) return ok([]);
    where.employeeId = session.employeeId;
    where.status = PayslipStatus.finalized;
  }

  const payslips = await prisma.payslip.findMany({
    where,
    include: { employee: { select: { id: true, fullName: true } } },
    orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }],
  });

  return ok(payslips);
}
