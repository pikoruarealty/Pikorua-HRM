import { PayslipStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";

// Track A. PATCH /api/v1/payslips/:id/finalize — Admin/HR. draft -> finalized.
// Once finalized, a payslip is read-only (no edit endpoint exists at all —
// TRACK_A_TASKS.md Milestone 3); this is the only state transition.
export async function PATCH(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  if (!session) {
    return failFor(ErrorCode.UNAUTHENTICATED);
  }
  if (!FINANCE_ROLES.includes(session.role)) {
    return failFor(ErrorCode.FORBIDDEN);
  }

  const existing = await prisma.payslip.findUnique({ where: { id: params.id } });
  if (!existing) {
    return failFor(ErrorCode.NOT_FOUND, "Payslip not found.");
  }
  if (existing.status === PayslipStatus.finalized) {
    return fail(ErrorCode.CONFLICT, "Payslip is already finalized.", 409);
  }

  const updated = await prisma.payslip.update({
    where: { id: params.id },
    data: { status: PayslipStatus.finalized },
  });

  return ok(updated);
}
