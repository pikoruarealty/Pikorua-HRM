import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";

// Track B. GET /api/v1/requests/:id — Milestone 1.3.

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const request = await prisma.request.findUnique({ where: { id: params.id } });
  if (!request) return failFor(ErrorCode.NOT_FOUND);

  const role = session.role;
  if (isFinanceRole(role)) return ok(request);

  if (!session.employeeId) return failFor(ErrorCode.NOT_FOUND);

  if (request.employeeId === session.employeeId) return ok(request);

  if (isLeadRole(role)) {
    const team = await prisma.team.findFirst({
      where: { teamLeadId: session.employeeId, members: { some: { id: request.employeeId } } },
    });
    if (team) return ok(request);
  }

  // Don't reveal existence of Requests outside the caller's scope.
  return failFor(ErrorCode.NOT_FOUND);
}
