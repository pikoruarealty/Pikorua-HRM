import { prisma } from "@/lib/db/prisma";
import { RequestStatus, RequestType } from "@prisma/client";

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
