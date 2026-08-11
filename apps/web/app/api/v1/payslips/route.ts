import { Prisma, PayslipStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { uuidFilter, intFilter } from "@/lib/api/params";

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
  // `?month=abc` used to reach Prisma as NaN and throw a bare 500, and
  // `?month=99` sailed through to a period that can never match — answering
  // 200 with an empty list, which reads as "you have no payslips" rather than
  // "that isn't a month".
  const employeeIdParam = uuidFilter(searchParams.get("employee_id"));
  const monthParam = intFilter(searchParams.get("month"), 1, 12);
  const yearParam = intFilter(searchParams.get("year"), 2000, 2100);
  if (employeeIdParam === null) return failFor(ErrorCode.VALIDATION, "employee_id must be a uuid.");
  if (monthParam === null) return failFor(ErrorCode.VALIDATION, "month must be an integer 1-12.");
  if (yearParam === null) return failFor(ErrorCode.VALIDATION, "year must be an integer 2000-2100.");

  const where: Prisma.PayslipWhereInput = {};
  if (monthParam !== undefined) where.periodMonth = monthParam;
  if (yearParam !== undefined) where.periodYear = yearParam;

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
