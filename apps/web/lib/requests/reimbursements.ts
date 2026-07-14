import { prisma } from "@/lib/db/prisma";
import { RequestStatus, RequestType } from "@prisma/client";
import { NotImplementedError } from "@/lib/errors";

// CROSS-TRACK CONTRACT (Implementation Plan §5). Owned/implemented by Track B;
// imported by Track A's payslip generation. The SIGNATURE below is the Phase 0
// agreement — do not change it without flagging Track A.
//
// Returns the total ₹ amount of APPROVED reimbursement requests
// (requests.type = 'reimbursement', status = 'approved') for the given
// employee in the given payroll period (month is 1-12).
//
// Reimbursement requests have no period field of their own (unlike leave's
// dateFrom/dateTo range), so the period is keyed off `approvedAt` — per PRD
// §5.2/§5.13 ("once approved, added into the payslip"), a reimbursement
// belongs to whichever payroll period it was approved in, not submitted in.
export async function getApprovedReimbursementTotal(
  employeeId: string,
  month: number,
  year: number,
): Promise<number> {
  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(year, month, 1));

  const result = await prisma.request.aggregate({
    where: {
      employeeId,
      type: RequestType.reimbursement,
      status: RequestStatus.approved,
      approvedAt: { gte: periodStart, lt: periodEnd },
    },
    _sum: { amount: true },
  });

  return Number(result._sum.amount ?? 0);
}

// CROSS-TRACK CONTRACT (added 2026-07-14, raised by Track A during payroll
// summary work). Owned/implemented by Track B; imported by Track A's payroll
// summary endpoint. The SIGNATURE below is the agreed contract — do not
// change it without flagging Track A.
//
// Returns the count of APPROVED unpaid-leave days (requests.type =
// 'leave_unpaid', status = 'approved') for the given employee overlapping
// the given payroll period (month is 1-12). Lives here rather than
// attendance_records because unpaid leave is tracked as a request, not an
// attendance punch.
//
// STUB ONLY as of 2026-07-14 — throws until Track B implements the real
// day-counting logic (incl. how to handle a leave range spanning two
// periods). Track A's summary endpoint should surface this error clearly in
// dev rather than treat a caught exception as zero.
export async function getApprovedUnpaidLeaveDays(
  employeeId: string,
  month: number,
  year: number,
): Promise<number> {
  throw new NotImplementedError("getApprovedUnpaidLeaveDays", "Track B");
}
