import { PayslipStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, Role } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { audit, clientIp } from "@/lib/audit";

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

// Admin manual override (2026-07-15). DELETE — **Admin only**, drafts only:
// the second half of the unfinalize → delete → regenerate correction flow.
// Finalized payslips can never be deleted directly (unfinalize first, which
// leaves its own audit row).
export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (session.role !== Role.admin) return failFor(ErrorCode.FORBIDDEN);

  const payslip = await prisma.payslip.findUnique({ where: { id: params.id } });
  if (!payslip) return failFor(ErrorCode.NOT_FOUND, "Payslip not found.");
  if (payslip.status !== PayslipStatus.draft) {
    return failFor(ErrorCode.CONFLICT, "Only draft payslips can be deleted — unfinalize first.");
  }

  await prisma.payslip.delete({ where: { id: params.id } });

  await audit({
    action: "payslip.delete_draft",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "payslip",
    entityId: params.id,
    metadata: {
      employee_id: payslip.employeeId,
      period: `${payslip.periodYear}-${payslip.periodMonth}`,
      net_pay: Number(payslip.netPay),
    },
    ip: clientIp(req),
  });

  return ok({ deleted: true });
}
