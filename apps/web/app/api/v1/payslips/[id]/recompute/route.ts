import { PayslipStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { audit, clientIp } from "@/lib/audit";
import { computePayslipPreview } from "@/lib/payroll/payslip-preview";

// Track A (2026-08-07). POST /api/v1/payslips/:id/recompute — Admin/HR,
// draft-only. `Payslip.baseSalary` (and every attendance-derived count) is
// intentionally a snapshot taken at generation time — a finalized payslip
// must never silently change. But a draft generated before, say, a salary
// edit or a late attendance approval has no way to pick up the new numbers
// short of delete + regenerate. This re-runs the same math
// (computePayslipPreview) against current employee/attendance data and
// updates the draft row in place; incentive/bonus/other manual adjustments
// already on the draft are preserved as-is (only the computed fields
// change), and it stays firmly Admin/HR — not the narrower Admin-only
// override tier, since this isn't a correction-after-decision like
// unfinalize, just refreshing a still-open draft.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!FINANCE_ROLES.includes(session.role)) return failFor(ErrorCode.FORBIDDEN);

  const payslip = await prisma.payslip.findUnique({ where: { id: params.id } });
  if (!payslip) return failFor(ErrorCode.NOT_FOUND, "Payslip not found.");
  if (payslip.status !== PayslipStatus.draft) {
    return fail(ErrorCode.CONFLICT, "Only draft payslips can be recomputed — finalized payslips are immutable snapshots.", 409);
  }

  const preview = await computePayslipPreview({
    employeeId: payslip.employeeId,
    month: payslip.periodMonth,
    year: payslip.periodYear,
    incentiveAmount: Number(payslip.incentiveAmount),
    bonusAmount: Number(payslip.bonusAmount),
    otherAdditionAmount: payslip.otherAdditionAmount ? Number(payslip.otherAdditionAmount) : 0,
    otherDeductionAmount: payslip.otherDeductionAmount ? Number(payslip.otherDeductionAmount) : 0,
  });
  if (!preview.ok) {
    return fail(preview.code, preview.message, preview.status);
  }

  const updated = await prisma.payslip.update({
    where: { id: params.id },
    data: {
      baseSalary: preview.baseSalary,
      lateCount: preview.lateCount,
      unpaidLeaveCount: preview.unpaidLeaveDays,
      halfDayCount: preview.halfDays,
      absentCount: preview.absentDays,
      presentCount: preview.presentDays,
      paidLeaveCount: preview.paidLeaveDays,
      holidayCount: preview.holidayDays,
      compensationCount: preview.compensationDays,
      earnedBasePay: preview.earnedBasePay,
      lateDeductionTotal: preview.lateDeductionTotal,
      reimbursementTotal: preview.reimbursementTotal,
      employeeOfMonthRef: preview.employeeOfMonthRef,
      netPay: preview.netPay,
    },
  });

  await audit({
    action: "payslip.recompute",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "payslip",
    entityId: params.id,
    metadata: {
      employee_id: payslip.employeeId,
      period: `${payslip.periodYear}-${payslip.periodMonth}`,
      base_salary_before: Number(payslip.baseSalary),
      base_salary_after: preview.baseSalary,
      net_pay_before: Number(payslip.netPay),
      net_pay_after: preview.netPay,
    },
    ip: clientIp(req),
  });

  return ok({ ...updated, notes: preview.notes });
}
