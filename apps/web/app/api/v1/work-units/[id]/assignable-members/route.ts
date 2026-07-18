import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { EmployeeStatus } from "@prisma/client";

// Track B. GET /api/v1/work-units/:id/assignable-members — the set of employees
// a task in this work unit may be reassigned to. This mirrors what each caller
// is actually *allowed* to assign to in the work-item POST/PATCH routes, so the
// dropdown never shows an option the server would then reject:
//   - Admin/HR: every active employee (finance roles have no team restriction).
//   - Owning Lead: active members of ALL teams they lead (a lead can lead more
//     than one team), plus themselves.
// Previously this scoped to a single `findFirst` team, so a multi-team lead —
// or an Admin reassigning across teams — only ever saw one team's members (the
// "I can only see the same employee" bug).
//
// RBAC: Admin/HR, or the owning Lead. 404 (not 403) otherwise so the unit's
// existence isn't revealed outside the caller's scope.

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const workUnit = await prisma.workUnit.findUnique({ where: { id: params.id } });
  if (!workUnit || workUnit.deletedAt) return failFor(ErrorCode.NOT_FOUND);

  const role = session.role;
  const isOwningLead = isLeadRole(role) && session.employeeId === workUnit.teamLeadId;
  if (!isFinanceRole(role) && !isOwningLead) {
    if (!isLeadRole(role)) return failFor(ErrorCode.FORBIDDEN);
    return failFor(ErrorCode.NOT_FOUND);
  }

  // Admin/HR can assign to anyone active; a Lead is scoped to the teams they
  // lead (any number of them) plus themselves.
  let where;
  if (isFinanceRole(role)) {
    where = { status: EmployeeStatus.active };
  } else {
    const teams = await prisma.team.findMany({
      where: { teamLeadId: workUnit.teamLeadId },
      select: { id: true },
    });
    where = {
      status: EmployeeStatus.active,
      OR: [{ teamId: { in: teams.map((t) => t.id) } }, { id: workUnit.teamLeadId }],
    };
  }

  const members = await prisma.employee.findMany({
    where,
    select: { id: true, fullName: true, role: true },
    orderBy: { fullName: "asc" },
  });

  return ok(members);
}
