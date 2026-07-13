import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, requireRole, AuthzError } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { RequestStatus } from "@prisma/client";

// Track B. PATCH /api/v1/requests/:id/reject — Milestone 1.3.
// Golden rule: Admin/HR only, always — Team Leads get 403 even for their own team.

export async function PATCH(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  try {
    requireRole(session, FINANCE_ROLES);
  } catch (err) {
    if (err instanceof AuthzError) return failFor(err.kind);
    throw err;
  }

  const request = await prisma.request.findUnique({ where: { id: params.id } });
  if (!request) return failFor(ErrorCode.NOT_FOUND);
  if (request.status !== RequestStatus.pending) {
    return failFor(ErrorCode.CONFLICT, "Only pending requests can be rejected.");
  }

  // Same hierarchy rule as approve: HR cannot reject their own request.
  const requester = await prisma.user.findUnique({ where: { employeeId: request.employeeId } });
  if (requester && requester.id === session!.userId) {
    return failFor(ErrorCode.FORBIDDEN, "Cannot reject your own request.");
  }

  const updated = await prisma.request.update({
    where: { id: params.id },
    data: {
      status: RequestStatus.rejected,
      approverId: session!.userId,
      approvedAt: new Date(),
    },
  });

  return ok(updated);
}
