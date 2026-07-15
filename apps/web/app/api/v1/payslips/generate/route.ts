import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { getAttendanceSummary } from "@/lib/attendance/summary";
import { getEffectivePayrollConfig } from "@/lib/payroll/config";
import { computeStandardDeductionTotal, computeNetPay } from "@/lib/payroll/calc";
import { audit, clientIp } from "@/lib/audit";
import { getApprovedReimbursementTotal } from "@/lib/requests/reimbursements";
import { getEmployeeOfMonthStatus } from "@/lib/recognition/employee-of-month";
import { NotImplementedError } from "@/lib/errors";

// Track A. POST /api/v1/payslips/generate — Admin/HR only.
//
// Deduction/reimbursement handling on cross-track NotImplementedError:
// - reimbursement_total (Track B) directly changes net_pay, so if it throws
//   we refuse to generate a payslip at all (422) rather than silently
//   computing a wrong net pay — this is the "never bluff" standing rule.
// - unpaid_leave_count (Track B, via lib/attendance/summary) already
//   degrades to null/"unavailable" upstream and is treated as 0 here with a
//   note, matching the attendance summary endpoint's existing behavior.
// - employee_of_month_ref (Track B) is explicitly reference-only per
//   API_SPEC.md — it never affects the calculation, so on NotImplementedError
//   we default it to false and surface a note instead of blocking generation.
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

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) {
    return failFor(ErrorCode.NOT_FOUND, "Employee not found.");
  }

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

  const config = await getEffectivePayrollConfig(month, year);
  if (!config) {
    return fail(
      ErrorCode.VALIDATION,
      "No payroll config is effective for this period. Set one via PUT /payroll/config first.",
      422,
    );
  }

  const summary = await getAttendanceSummary(employeeId, month, year);
  const unpaidLeaveCount = summary.unpaidLeaveCount ?? 0;

  let reimbursementTotal: number;
  try {
    reimbursementTotal = await getApprovedReimbursementTotal(employeeId, month, year);
  } catch (err) {
    if (err instanceof NotImplementedError) {
      return fail(
        ErrorCode.NOT_IMPLEMENTED,
        "Track B has not implemented getApprovedReimbursementTotal yet — cannot generate a payslip with an unknown reimbursement total.",
        422,
      );
    }
    throw err;
  }

  let employeeOfMonthRef = false;
  let employeeOfMonthUnavailable = false;
  try {
    employeeOfMonthRef = await getEmployeeOfMonthStatus(employeeId, month, year);
  } catch (err) {
    if (err instanceof NotImplementedError) {
      employeeOfMonthUnavailable = true;
    } else {
      throw err;
    }
  }

  const standardDeductionTotal = computeStandardDeductionTotal(
    { lateCount: summary.lateCount, halfDayCount: summary.halfDayCount, unpaidLeaveCount },
    {
      lateDeductionFlat: Number(config.lateDeductionFlat),
      halfDayDeductionFlat: Number(config.halfDayDeductionFlat),
      unpaidLeaveDeductionFlat: Number(config.unpaidLeaveDeductionFlat),
    },
  );

  const baseSalary = Number(employee.baseSalary);

  const netPay = computeNetPay(
    {
      baseSalary,
      incentiveAmount,
      bonusAmount,
      otherAdditionAmount: otherAdditionAmount ?? 0,
      otherDeductionAmount: otherDeductionAmount ?? 0,
      reimbursementTotal,
    },
    standardDeductionTotal,
  );

  const payslip = await prisma.payslip.create({
    data: {
      employeeId,
      periodMonth: month,
      periodYear: year,
      baseSalary,
      incentiveAmount,
      bonusAmount,
      bonusReason,
      otherAdditionAmount: otherAdditionAmount ?? null,
      otherAdditionReason,
      otherDeductionAmount: otherDeductionAmount ?? null,
      otherDeductionReason,
      lateCount: summary.lateCount,
      unpaidLeaveCount,
      halfDayCount: summary.halfDayCount,
      standardDeductionTotal,
      reimbursementTotal,
      employeeOfMonthRef,
      netPay,
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
      net_pay: netPay,
      standard_deduction_total: standardDeductionTotal,
      reimbursement_total: reimbursementTotal,
    },
    ip: clientIp(req),
  });

  return ok({
    ...payslip,
    notes: {
      late_tracking_unavailable: summary.lateTrackingUnavailable
        ? "This employee's team has no expected_start_time configured — late count excludes those days."
        : undefined,
      unpaid_leave_unavailable: summary.unpaidLeaveUnavailable
        ? "Track B has not implemented getApprovedUnpaidLeaveDays yet — treated as 0 for this payslip."
        : undefined,
      employee_of_month_unavailable: employeeOfMonthUnavailable
        ? "Track B has not implemented getEmployeeOfMonthStatus yet — reference badge defaulted to false."
        : undefined,
    },
  }, 201);
}
