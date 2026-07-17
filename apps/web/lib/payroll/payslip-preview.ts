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
  notes: {
    late_tracking_unavailable?: string;
    employee_of_month_unavailable?: string;
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
  const [summary, breakdown] = await Promise.all([
    getAttendanceSummary(employeeId, month, year, config.lateGraceMinutes),
    getMonthlyAttendanceBreakdown(employeeId, month, year),
  ]);

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
  const perDayRate = computePerDayRate(baseSalary);

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
    notes: {
      late_tracking_unavailable: summary.lateTrackingUnavailable
        ? "This employee's team has no expected_start_time configured — late count excludes those days."
        : undefined,
      employee_of_month_unavailable: employeeOfMonthUnavailable
        ? "Track B has not implemented getEmployeeOfMonthStatus yet — reference badge defaulted to false."
        : undefined,
    },
  };
}
