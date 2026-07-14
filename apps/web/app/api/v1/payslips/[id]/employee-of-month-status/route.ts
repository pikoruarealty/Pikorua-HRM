import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { getEmployeeOfMonthStatus } from "@/lib/recognition/employee-of-month";
import { NotImplementedError } from "@/lib/errors";

// Track A. GET /api/v1/payslips/:employee_id/employee-of-month-status
// (folder is [id], not [employee_id] — same Next.js one-dynamic-segment-name-
// per-level reason as attendance/[id]; this level also serves payslip *id*
// for GET /payslips/:id and PATCH /payslips/:id/finalize). Admin/HR only.
// Reference-only lookup for the payslip generation screen — never affects
// the calculation itself (API_SPEC.md §6).
const querySchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
});

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  if (!session) {
    return failFor(ErrorCode.UNAUTHENTICATED);
  }
  if (!FINANCE_ROLES.includes(session.role)) {
    return failFor(ErrorCode.FORBIDDEN);
  }

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse({
    month: searchParams.get("month"),
    year: searchParams.get("year"),
  });
  if (!parsed.success) {
    return failFor(ErrorCode.VALIDATION, "month (1-12) and year are required query params.");
  }
  const { month, year } = parsed.data;

  const employee = await prisma.employee.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!employee) {
    return failFor(ErrorCode.NOT_FOUND, "Employee not found.");
  }

  try {
    const isEmployeeOfMonth = await getEmployeeOfMonthStatus(params.id, month, year);
    return ok({ employee_id: params.id, month, year, is_employee_of_month: isEmployeeOfMonth });
  } catch (err) {
    if (err instanceof NotImplementedError) {
      return fail(
        ErrorCode.NOT_IMPLEMENTED,
        "Track B has not implemented getEmployeeOfMonthStatus yet.",
        501,
      );
    }
    throw err;
  }
}
