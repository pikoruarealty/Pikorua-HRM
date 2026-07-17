import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { EmployeeStatus } from "@prisma/client";

// Track B. GET /api/v1/work-units/:id/assignable-members — the set of employees
// a task in this work unit may be assigned to: the active members of the team
// led by this unit's teamLead, plus the lead. Single source of truth for the
// "team members only" rule (matches the findFirst-team check the work-item
// POST/PATCH routes already use for Lead assignment validation).
//
// RBAC: Admin/HR, or the owning Lead. 404 (not 403) otherwise so the unit's
// existence isn't revealed outside the caller's scope.

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const workUnit = await prisma.workUnit.findUnique({ where: { id: params.id } });
  if (!workUnit) return failFor(ErrorCode.NOT_FOUND);

  const role = session.role;
  const isOwningLead = isLeadRole(role) && session.employeeId === workUnit.teamLeadId;
  if (!isFinanceRole(role) && !isOwningLead) {
    if (!isLeadRole(role)) return failFor(ErrorCode.FORBIDDEN);
    return failFor(ErrorCode.NOT_FOUND);
  }

  const team = await prisma.team.findFirst({ where: { teamLeadId: workUnit.teamLeadId } });

  const members = await prisma.employee.findMany({
    where: {
      status: EmployeeStatus.active,
      OR: [...(team ? [{ teamId: team.id }] : []), { id: workUnit.teamLeadId }],
    },
    select: { id: true, fullName: true, role: true },
    orderBy: { fullName: "asc" },
  });

  return ok(members);
}
