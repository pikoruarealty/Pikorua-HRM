import { prisma } from "@/lib/db/prisma";
import { getAttendanceSummary } from "@/lib/attendance/summary";
import { getMonthlyAttendanceBreakdown } from "@/lib/attendance/monthly-breakdown";
import { getEffectivePayrollConfig } from "@/lib/payroll/config";
import {
  computeEarnedBasePay,
  computeLateDeductionTotal,
  computeNetPay,
  computePerDayRate,
} from "@/lib/payroll/calc";
import { getApprovedReimbursementTotal } from "@/lib/requests/reimbursements";
import { getEmployeeOfMonthStatus } from "@/lib/recognition/employee-of-month";
import { computeCompensationRedemption, type CompensationRedemption } from "@/lib/attendance/compensation-credits";
import { NotImplementedError } from "@/lib/errors";
import { ErrorCode, type ErrorCodeValue } from "@/lib/api/response";

// Track A (2026-07-17). Shared core of payslip math + the cross-track calls
// it depends on — used by both POST /payslips/generate (persists the
// result) and POST /payslips/preview (read-only, so the Generate Payslip
// screen can show the projected breakdown/net pay live, before the user
// commits). Keeping this in one place means the two can never drift apart.

export type PayslipPreviewInput = {
  employeeId: string;
  month: number;
  year: number;
  incentiveAmount: number;
  bonusAmount: number;
  otherAdditionAmount: number;
  otherDeductionAmount: number;
};

export type PayslipPreviewResult = {
  baseSalary: number;
  perDayRate: number;
  presentDays: number;
  halfDays: number;
  paidLeaveDays: number;
  holidayDays: number;
  compensationDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
  lateCount: number;
  earnedBasePay: number;
  lateDeductionTotal: number;
  reimbursementTotal: number;
  employeeOfMonthRef: boolean;
  netPay: number;
  /** Count of absent/leave_unpaid days converted to paid via a compensation
   *  credit (see lib/attendance/compensation-credits.ts) — already folded
   *  into paidLeaveDays/absentDays/unpaidLeaveDays above. */
  compensationCreditsRedeemed: number;
  /** The exact allocation behind compensationCreditsRedeemed — generate/
   *  recompute commit this list transactionally so what was previewed is
   *  exactly what gets persisted. */
  compensationRedemptions: CompensationRedemption[];
  notes: {
    late_tracking_unavailable?: string;
    employee_of_month_unavailable?: string;
    compensation_credits_redeemed?: string;
  };
};

export type PayslipPreviewError = {
  ok: false;
  code: ErrorCodeValue;
  message: string;
  status: number;
};

export type PayslipPreviewOk = { ok: true } & PayslipPreviewResult;

export async function computePayslipPreview(
  input: PayslipPreviewInput,
): Promise<PayslipPreviewOk | PayslipPreviewError> {
  const { employeeId, month, year, incentiveAmount, bonusAmount, otherAdditionAmount, otherDeductionAmount } =
    input;

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) {
    return { ok: false, code: ErrorCode.NOT_FOUND, message: "Employee not found.", status: 404 };
  }

  const config = await getEffectivePayrollConfig(month, year);
  if (!config) {
    return {
      ok: false,
      code: ErrorCode.VALIDATION,
      message: "No payroll config is effective for this period. Set one via PUT /payroll/config first.",
      status: 422,
    };
  }

  // lateCount (+ its lateTrackingUnavailable note) comes from the approved-
  // attendance summary — nothing else computes late-arrival. Every other
  // count (present/half/paid-leave/holiday/compensation/unpaid/absent) comes
  // from the day-by-day monthly breakdown, which is holiday- and
  // Sunday-compensation-aware.
  const [summary, breakdown, compensationRedemptions] = await Promise.all([
    getAttendanceSummary(employeeId, month, year, config.lateGraceMinutes),
    getMonthlyAttendanceBreakdown(employeeId, month, year),
    computeCompensationRedemption(employeeId, month, year),
  ]);

  // Fold redemptions into the breakdown before they reach computeEarnedBasePay
  // — each redeemed day moves from unpaid to paid, per the owner's "compensate
  // for my leaves ... reflect in current month's payslip" requirement.
  // Absences are redeemed before unpaid-leave-request days (see
  // compensation-credits.ts point 5), so each pool is decremented by its own
  // redemption count, not the combined total.
  const absenceRedemptions = compensationRedemptions.filter((r) => r.kind === "absence").length;
  const unpaidLeaveRedemptions = compensationRedemptions.length - absenceRedemptions;
  breakdown.paidLeaveDays += compensationRedemptions.length;
  breakdown.absentDays = Math.max(0, breakdown.absentDays - absenceRedemptions);
  breakdown.unpaidLeaveDays = Math.max(0, breakdown.unpaidLeaveDays - unpaidLeaveRedemptions);

  let reimbursementTotal: number;
  try {
    reimbursementTotal = await getApprovedReimbursementTotal(employeeId, month, year);
  } catch (err) {
    if (err instanceof NotImplementedError) {
      return {
        ok: false,
        code: ErrorCode.NOT_IMPLEMENTED,
        message:
          "Track B has not implemented getApprovedReimbursementTotal yet — cannot compute a payslip with an unknown reimbursement total.",
        status: 422,
      };
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

  const baseSalary = Number(employee.baseSalary);
  const perDayRate = computePerDayRate(baseSalary, employee.requiredDaysPerWeek);

  const earnedBasePay = computeEarnedBasePay(
    {
      presentDays: breakdown.presentDays,
      halfDays: breakdown.halfDays,
      paidLeaveDays: breakdown.paidLeaveDays,
      holidayDays: breakdown.holidayDays,
      compensationDays: breakdown.compensationDays,
    },
    perDayRate,
  );

  const lateDeductionTotal = computeLateDeductionTotal(
    summary.lateCount,
    perDayRate,
    Number(config.lateDeductionPercent),
  );

  const netPay = computeNetPay(
    {
      earnedBasePay,
      incentiveAmount,
      bonusAmount,
      otherAdditionAmount,
      otherDeductionAmount,
      reimbursementTotal,
    },
    lateDeductionTotal,
  );

  return {
    ok: true,
    baseSalary,
    perDayRate,
    presentDays: breakdown.presentDays,
    halfDays: breakdown.halfDays,
    paidLeaveDays: breakdown.paidLeaveDays,
    holidayDays: breakdown.holidayDays,
    compensationDays: breakdown.compensationDays,
    unpaidLeaveDays: breakdown.unpaidLeaveDays,
    absentDays: breakdown.absentDays,
    lateCount: summary.lateCount,
    earnedBasePay,
    lateDeductionTotal,
    reimbursementTotal,
    employeeOfMonthRef,
    netPay,
    compensationCreditsRedeemed: compensationRedemptions.length,
    compensationRedemptions,
    notes: {
      late_tracking_unavailable: summary.lateTrackingUnavailable
        ? "This employee's team has no expected_start_time configured — late count excludes those days."
        : undefined,
      employee_of_month_unavailable: employeeOfMonthUnavailable
        ? "Track B has not implemented getEmployeeOfMonthStatus yet — reference badge defaulted to false."
        : undefined,
      compensation_credits_redeemed:
        compensationRedemptions.length > 0
          ? [
              absenceRedemptions > 0 ? `${absenceRedemptions} absent day(s)` : null,
              unpaidLeaveRedemptions > 0 ? `${unpaidLeaveRedemptions} unpaid-leave day(s)` : null,
            ]
              .filter(Boolean)
              .join(" and ") + " converted to paid using compensation credit(s) earned within the last 60 days."
          : undefined,
    },
  };
}
