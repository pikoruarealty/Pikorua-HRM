import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isEmployeeRole, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";

// Track B. GET /api/v1/work-items/mine — Milestone 1.2.
// Any role that can be a WorkItem assignee can query their own tasks here —
// Leads have Employee records too and can be assigned WorkItems just like
// anyone else, so they're not excluded (API_SPEC.md's "Employee" row means
// "self", not the strict EMPLOYEE_ROLES group).

export async function GET() {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!isEmployeeRole(session.role) && !isLeadRole(session.role)) return failFor(ErrorCode.FORBIDDEN);
  if (!session.employeeId) return ok([]);

  const workItems = await prisma.workItem.findMany({
    where: { assignedTo: session.employeeId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });

  return ok(workItems);
}
