import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { redactRequestFinancials } from "@/lib/requests/redact";

// Track B. GET /api/v1/requests/:id — Milestone 1.3.

const EMPLOYEE_SUMMARY = {
  select: {
    id: true,
    fullName: true,
    email: true,
    role: true,
    department: { select: { name: true } },
    team: { select: { name: true } },
  },
} as const;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const request = await prisma.request.findUnique({
    where: { id: params.id },
    include: { employee: EMPLOYEE_SUMMARY },
  });
  if (!request) return failFor(ErrorCode.NOT_FOUND);
  const withFlag = { ...request, hasAttachment: request.attachmentUrl != null };

  const role = session.role;
  // Only Admin/HR see reimbursement financial fields (golden rule); everyone
  // else gets the amount/attachment stripped.
  if (isFinanceRole(role)) return ok(withFlag);

  if (!session.employeeId) return failFor(ErrorCode.NOT_FOUND);

  // The owner sees their own financials (they filed it and can open their own
  // bill); everyone below finance has amount/attachment stripped.
  if (request.employeeId === session.employeeId) return ok(withFlag);

  if (isLeadRole(role)) {
    const team = await prisma.team.findFirst({
      where: { teamLeadId: session.employeeId, members: { some: { id: request.employeeId } } },
    });
    if (team) return ok({ ...redactRequestFinancials(withFlag), hasAttachment: false });
  }

  // Don't reveal existence of Requests outside the caller's scope.
  return failFor(ErrorCode.NOT_FOUND);
}
