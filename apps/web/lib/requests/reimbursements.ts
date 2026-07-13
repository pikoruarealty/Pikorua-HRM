import { NotImplementedError } from "@/lib/errors";

// CROSS-TRACK CONTRACT (Implementation Plan §5). Owned/implemented by Track B;
// imported by Track A's payslip generation. The SIGNATURE below is the Phase 0
// agreement — do not change it without flagging Track A.
//
// Returns the total ₹ amount of APPROVED reimbursement requests
// (requests.type = 'reimbursement', status = 'approved') for the given
// employee in the given payroll period (month is 1-12).
//
// Track B: replace the throw with the real query against `requests`.
export async function getApprovedReimbursementTotal(
  _employeeId: string,
  _month: number,
  _year: number,
): Promise<number> {
  throw new NotImplementedError("getApprovedReimbursementTotal", "Track B");
}
