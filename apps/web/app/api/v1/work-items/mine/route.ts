import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isEmployeeRole, isLeadRole, Role } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";

// Track B. GET /api/v1/work-items/mine — Milestone 1.2.
// Any role that can be a WorkItem assignee can query their own tasks here —
// Leads have Employee records too and can be assigned WorkItems just like
// anyone else, so they're not excluded (API_SPEC.md's "Employee" row means
// "self", not the strict EMPLOYEE_ROLES group). HR clocks in and works like
// an employee day-to-day (unlike Admin, who doesn't clock in — the "My
// Tasks" nav item is hidden for Admin but shown for HR), so HR is included
// too (2026-08-11 fix — the nav already promised this, the route didn't).

export async function GET() {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!isEmployeeRole(session.role) && !isLeadRole(session.role) && session.role !== Role.hr) {
    return failFor(ErrorCode.FORBIDDEN);
  }
  if (!session.employeeId) return ok([]);

  const workItems = await prisma.workItem.findMany({
    where: { assignedTo: session.employeeId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });

  return ok(workItems);
}
