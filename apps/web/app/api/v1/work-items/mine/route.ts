import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isEmployeeRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";

// Track B. GET /api/v1/work-items/mine — Milestone 1.2.

export async function GET() {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!isEmployeeRole(session.role)) return failFor(ErrorCode.FORBIDDEN);
  if (!session.employeeId) return ok([]);

  const workItems = await prisma.workItem.findMany({
    where: { assignedTo: session.employeeId },
    orderBy: { createdAt: "desc" },
  });

  return ok(workItems);
}
