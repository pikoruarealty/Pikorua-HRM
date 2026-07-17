import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { audit, clientIp } from "@/lib/audit";
import { computePayslipPreview } from "@/lib/payroll/payslip-preview";

// Track A. POST /api/v1/payslips/generate — Admin/HR only. The money math +
// cross-track calls live in lib/payroll/payslip-preview.ts (shared with the
// read-only POST /payslips/preview endpoint, so the two can never drift).
const bodySchema = z.object({
  employee_id: z.string().uuid(),
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
  incentive_amount: z.coerce.number().nonnegative().default(0),
  bonus_amount: z.coerce.number().nonnegative().default(0),
  bonus_reason: z.string().optional(),
  other_addition_amount: z.coerce.number().nonnegative().optional(),
  other_addition_reason: z.string().optional(),
  other_deduction_amount: z.coerce.number().nonnegative().optional(),
  other_deduction_reason: z.string().optional(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return failFor(ErrorCode.UNAUTHENTICATED);
  }
  if (!FINANCE_ROLES.includes(session.role)) {
    return failFor(ErrorCode.FORBIDDEN);
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return fail(ErrorCode.VALIDATION, "Invalid payslip generation payload.", 422);
  }
  const {
    employee_id: employeeId,
    month,
    year,
    incentive_amount: incentiveAmount,
    bonus_amount: bonusAmount,
    bonus_reason: bonusReason,
    other_addition_amount: otherAdditionAmount,
    other_addition_reason: otherAdditionReason,
    other_deduction_amount: otherDeductionAmount,
    other_deduction_reason: otherDeductionReason,
  } = parsed.data;

  const existing = await prisma.payslip.findUnique({
    where: { employeeId_periodYear_periodMonth: { employeeId, periodYear: year, periodMonth: month } },
  });
  if (existing) {
    return fail(
      ErrorCode.CONFLICT,
      `A payslip already exists for this employee for ${month}/${year}.`,
      409,
    );
  }

  const preview = await computePayslipPreview({
    employeeId,
    month,
    year,
    incentiveAmount,
    bonusAmount,
    otherAdditionAmount: otherAdditionAmount ?? 0,
    otherDeductionAmount: otherDeductionAmount ?? 0,
  });
  if (!preview.ok) {
    return fail(preview.code, preview.message, preview.status);
  }

  const payslip = await prisma.payslip.create({
    data: {
      employeeId,
      periodMonth: month,
      periodYear: year,
      baseSalary: preview.baseSalary,
      incentiveAmount,
      bonusAmount,
      bonusReason,
      otherAdditionAmount: otherAdditionAmount ?? null,
      otherAdditionReason,
      otherDeductionAmount: otherDeductionAmount ?? null,
      otherDeductionReason,
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
      generatedById: session.userId,
    },
  });

  await audit({
    action: "payslip.generate",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "payslip",
    entityId: payslip.id,
    metadata: {
      employee_id: employeeId,
      period: `${year}-${month}`,
      net_pay: preview.netPay,
      earned_base_pay: preview.earnedBasePay,
      late_deduction_total: preview.lateDeductionTotal,
      reimbursement_total: preview.reimbursementTotal,
    },
    ip: clientIp(req),
  });

  return ok({ ...payslip, notes: preview.notes }, 201);
}
