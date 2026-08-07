import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole, isLeadRole, rolesAtOrBelow } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { EmployeeStatus } from "@prisma/client";

// Track B. GET /api/v1/work-units/:id/assignable-members — the set of employees
// a task in this work unit may be reassigned to. This mirrors what each caller
// is actually *allowed* to assign to in the work-item POST/PATCH routes, so the
// dropdown never shows an option the server would then reject:
//   - Admin/HR: every active employee (finance roles have no restriction).
//   - Owning project lead (can be any role, 2026-08-07 — was Lead-role-only):
//     active employees in the WorkUnit's own department whose role is at the
//     project lead's tier or below (lib/rbac's canAssignAtOrBelow hierarchy —
//     Admin/HR > Lead roles > individual contributors), plus themselves.
// Previously this scoped to Team.teamLeadId membership, so a project lead who
// wasn't literally an org-team's registered lead couldn't assign to anyone.
//
// RBAC: Admin/HR, or the owning project lead. 404 (not 403) otherwise so the
// unit's existence isn't revealed outside the caller's scope.

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const workUnit = await prisma.workUnit.findUnique({ where: { id: params.id } });
  if (!workUnit || workUnit.deletedAt) return failFor(ErrorCode.NOT_FOUND);

  const role = session.role;
  const isProjectLead = session.employeeId === workUnit.projectLeadId;
  if (!isFinanceRole(role) && !isProjectLead) {
    if (!isLeadRole(role)) return failFor(ErrorCode.FORBIDDEN);
    return failFor(ErrorCode.NOT_FOUND);
  }

  // Admin/HR can assign to anyone active; a project lead is scoped to their
  // own department, at their hierarchy tier or below, plus themselves.
  let where;
  if (isFinanceRole(role)) {
    where = { status: EmployeeStatus.active };
  } else {
    where = {
      status: EmployeeStatus.active,
      OR: [
        { departmentId: workUnit.departmentId, role: { in: rolesAtOrBelow(role) } },
        { id: workUnit.projectLeadId },
      ],
    };
  }

  const members = await prisma.employee.findMany({
    where,
    select: { id: true, fullName: true, role: true },
    orderBy: { fullName: "asc" },
  });

  return ok(members);
}
