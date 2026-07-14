import { PayslipStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";

// Track A. GET /api/v1/payslips/:id — Admin/HR (any), Employee (self only,
// and only if finalized — drafts are never visible to the employee).
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  if (!session) {
    return failFor(ErrorCode.UNAUTHENTICATED);
  }

  const payslip = await prisma.payslip.findUnique({
    where: { id: params.id },
    include: { employee: { select: { id: true, fullName: true } } },
  });
  if (!payslip) {
    return failFor(ErrorCode.NOT_FOUND, "Payslip not found.");
  }

  const isFinance = FINANCE_ROLES.includes(session.role);
  const isSelf = session.employeeId === payslip.employeeId;
  if (!isFinance) {
    if (!isSelf || payslip.status !== PayslipStatus.finalized) {
      return failFor(ErrorCode.FORBIDDEN);
    }
  }

  return ok(payslip);
}
