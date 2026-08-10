import { prisma } from "@/lib/db/prisma";
import { isFinanceRole, isLeadRole, type Role } from "@/lib/rbac";
import { getLedEmployeeIds } from "@/lib/employees/managed-scope";

// Pillar 4/5 (2026-08-10) — who may see and act on whose sales data.
//
// Same shape as the existing team-task-progress RBAC (Admin/HR see everyone, a
// Lead sees the teams they lead plus themselves), factored out here because
// three routes need it: the team dashboard, the offline-claim list, and the
// offline-claim review.

export type SalesScope =
  /** Admin/HR — every active employee. */
  | { kind: "all" }
  /** A Lead — the union of their teams' members, plus themselves. */
  | { kind: "scoped"; employeeIds: string[] }
  /** Anyone else — themselves only. */
  | { kind: "self"; employeeId: string };

export async function resolveSalesScope(session: {
  role: Role;
  employeeId: string | null;
}): Promise<SalesScope | null> {
  if (isFinanceRole(session.role)) return { kind: "all" };
  if (!session.employeeId) return null;
  if (isLeadRole(session.role)) {
    return { kind: "scoped", employeeIds: await getLedEmployeeIds(session.employeeId) };
  }
  return { kind: "self", employeeId: session.employeeId };
}

/** Can this session approve or reject the given employee's offline claims?
 *  Never true for the claimant themselves — self-approval would defeat the
 *  entire "rep proposes, Lead approves" design. */
export async function canReviewClaimsFor(
  session: { role: Role; employeeId: string | null },
  claimantId: string,
): Promise<boolean> {
  if (session.employeeId === claimantId) return false;
  if (isFinanceRole(session.role)) return true;
  if (!isLeadRole(session.role) || !session.employeeId) return false;
  const led = await getLedEmployeeIds(session.employeeId);
  return led.includes(claimantId);
}

/** Employee ids a scope covers, resolved against the active roster. */
export async function scopeToEmployeeIds(scope: SalesScope): Promise<string[]> {
  if (scope.kind === "self") return [scope.employeeId];
  if (scope.kind === "scoped") return scope.employeeIds;
  const all = await prisma.employee.findMany({
    where: { status: "active" },
    select: { id: true },
  });
  return all.map((e) => e.id);
}
