import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole, isLeadRole } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { explainWorkItem, GroqError } from "@/lib/ai/task-generation";

// Track B. POST /api/v1/work-items/:id/explain — AI explanation of what's
// expected of the assignee for this task. Ephemeral (no DB write).
//
// RBAC: the assignee, or a viewer who could edit it (Admin/HR / owning Lead) —
// mirrors the viewer logic of PATCH /work-items/:id.

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const workItem = await prisma.workItem.findUnique({
    where: { id: params.id },
    include: { subUnit: { include: { workUnit: true } } },
  });
  if (!workItem || workItem.deletedAt) return failFor(ErrorCode.NOT_FOUND);

  const role = session.role;
  const isOwningLead = isLeadRole(role) && session.employeeId === workItem.subUnit.workUnit.teamLeadId;
  const isAssignee = session.employeeId === workItem.assignedTo;
  if (!isFinanceRole(role) && !isOwningLead && !isAssignee) {
    return failFor(ErrorCode.FORBIDDEN);
  }

  try {
    const { explanation } = await explainWorkItem({
      workItemTitle: workItem.title,
      subUnitName: workItem.subUnit.name,
      workUnitName: workItem.subUnit.workUnit.name,
      description: workItem.subUnit.workUnit.description,
      mode: workItem.mode,
    });
    return ok({ explanation });
  } catch (e) {
    if (e instanceof GroqError) return fail(ErrorCode.INTERNAL, `Explanation failed: ${e.message}`, 502);
    throw e;
  }
}
