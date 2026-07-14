import { NotImplementedError } from "@/lib/errors";

// CROSS-TRACK CONTRACT — added 2026-07-13 (not in the original Phase 0
// agreement, which only covered getApprovedReimbursementTotal and
// getEmployeeOfMonthStatus; see docs/IMPLEMENTATION_PLAN.md §5 and
// docs/TRACK_A_TASKS.md Milestone 2 notes). Owned/implemented by Track B;
// imported by Track A's attendance summary + payslip generation. The
// SIGNATURE below is the agreement — do not change it without flagging
// Track A. Flag this addition to Bhavarth before relying on it in production.
//
// Returns the count of APPROVED unpaid-leave days (requests.type =
// 'leave_unpaid', status = 'approved', date range) for the given employee
// that fall within the given payroll/attendance period (month is 1-12).
//
// Track B: replace the throw with the real query against `requests`.
export async function getApprovedUnpaidLeaveDays(
  _employeeId: string,
  _month: number,
  _year: number,
): Promise<number> {
  throw new NotImplementedError("getApprovedUnpaidLeaveDays", "Track B");
}
