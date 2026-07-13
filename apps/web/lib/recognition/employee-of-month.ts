import { NotImplementedError } from "@/lib/errors";

// CROSS-TRACK CONTRACT (Implementation Plan §5). Owned/implemented by Track B;
// imported by Track A's payslip generation screen (reference display only —
// does NOT affect the payslip calculation). The SIGNATURE is the Phase 0
// agreement — do not change it without flagging Track A.
//
// Returns whether this employee was Employee of the Month for their department
// in the given period (from recognition_snapshots.is_employee_of_month on the
// monthly snapshot). month is 1-12.
//
// Track B: replace the throw with the real query against `recognition_snapshots`.
export async function getEmployeeOfMonthStatus(
  _employeeId: string,
  _month: number,
  _year: number,
): Promise<boolean> {
  throw new NotImplementedError("getEmployeeOfMonthStatus", "Track B");
}
