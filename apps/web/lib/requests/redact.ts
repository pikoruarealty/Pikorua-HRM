import { RequestType } from "@prisma/client";

// Golden-rule guard (2026-07-16). Reimbursement amount + attachment are
// financial data: PRD §3 restricts "reimbursement details of any employee" to
// Admin/HR only, and §5.9 limits Team Leads to request *statuses*. GET /requests
// and GET /requests/:id therefore run every NON-finance viewer's rows through
// this before returning, so a Lead (or anyone else) sees that a reimbursement
// exists and its status, but never the ₹ amount or the receipt link.
//
// Leave requests carry no financial fields and pass through untouched.
export function redactRequestFinancials<
  T extends { type: RequestType; amount?: unknown; attachmentUrl?: unknown },
>(request: T): T {
  if (request.type === RequestType.reimbursement) {
    return { ...request, amount: null, attachmentUrl: null };
  }
  return request;
}
