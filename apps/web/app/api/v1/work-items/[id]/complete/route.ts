import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { WorkItemMode, WorkItemStatus } from "@prisma/client";

// Track B. POST /api/v1/work-items/:id/complete — Milestone 2.3.
// Assigned Employee only (per API_SPEC §5 — no Lead/Admin override here;
// use PATCH /work-items/:id for corrections). Marks the atomic task
// completed and credits task_points to employee_point_ledger, both inside
// one transaction, so a task is never "completed" without its points (or
// vice versa). Metric-mode items complete automatically via PATCH's
// current>=target check and are rejected here.

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const workItem = await prisma.workItem.findUnique({ where: { id: params.id } });
  if (!workItem) return failFor(ErrorCode.NOT_FOUND);

  if (session.employeeId !== workItem.assignedTo) {
    return failFor(ErrorCode.FORBIDDEN, "Only the assigned employee can complete this task.");
  }
  if (workItem.mode !== WorkItemMode.atomic) {
    return failFor(ErrorCode.VALIDATION, "Only atomic-mode WorkItems are completed via this endpoint.");
  }
  if (workItem.status === WorkItemStatus.completed) {
    return failFor(ErrorCode.CONFLICT, "This task is already completed.");
  }

  const [updated] = await prisma.$transaction([
    prisma.workItem.update({
      where: { id: workItem.id },
      data: { status: WorkItemStatus.completed, completedAt: new Date() },
    }),
    prisma.employeePointLedger.create({
      data: {
        employeeId: workItem.assignedTo,
        workItemId: workItem.id,
        points: workItem.taskPoints!,
      },
    }),
  ]);

  return ok({ workItem: updated, pointsCredited: workItem.taskPoints });
}
