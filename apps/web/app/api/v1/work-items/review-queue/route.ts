import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { WorkItemStatus } from "@prisma/client";

// GET /api/v1/work-items/review-queue — everything sitting in `in_review` that
// the caller is allowed to act on (Pillar 2, 2026-08-08). Admin/HR see the
// whole company; anyone else sees only the WorkUnits they lead, which is
// exactly the set POST /work-items/:id/review will accept from them.
//
// Deliberately not paginated: the queue is meant to stay short — if a lead has
// hundreds of unreviewed tasks, the number itself is the signal.

export async function GET() {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!session.employeeId && !isFinanceRole(session.role)) return ok([]);

  const items = await prisma.workItem.findMany({
    where: {
      status: WorkItemStatus.in_review,
      deletedAt: null,
      ...(isFinanceRole(session.role)
        ? {}
        : { subUnit: { workUnit: { projectLeadId: session.employeeId! } } }),
    },
    include: {
      assignee: { select: { id: true, fullName: true, photoUrl: true } },
      subUnit: { select: { id: true, name: true, workUnit: { select: { id: true, name: true } } } },
    },
    // Oldest submission first — the person who has been waiting longest is at
    // the top of the lead's list.
    orderBy: { submittedAt: "asc" },
  });

  return ok(
    items.map((wi) => ({
      id: wi.id,
      title: wi.title,
      description: wi.description,
      dueDate: wi.dueDate,
      taskPoints: wi.taskPoints,
      submittedAt: wi.submittedAt,
      selfLogged: wi.selfLogged,
      freeText: wi.selfLogged && !wi.adhocTypeId,
      assignee: {
        id: wi.assignee.id,
        fullName: wi.assignee.fullName,
        photoUrl: wi.assignee.photoUrl ? `/api/v1/employees/${wi.assignee.id}/photo` : null,
      },
      subUnitId: wi.subUnit.id,
      subUnitName: wi.subUnit.name,
      workUnitId: wi.subUnit.workUnit.id,
      workUnitName: wi.subUnit.workUnit.name,
    })),
  );
}
