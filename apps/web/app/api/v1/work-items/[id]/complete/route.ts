import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { Prisma, WorkItemMode, WorkItemStatus } from "@prisma/client";
import { isClockedInNow } from "@/lib/attendance/status";
import { requiresReviewForItem } from "@/lib/work/review";
import { notifyReviewSubmitted } from "@/lib/work/notify";

// Track B. POST /api/v1/work-items/:id/complete — Milestone 2.3.
// Assigned Employee only (per API_SPEC §5 — no Lead/Admin override here;
// use PATCH /work-items/:id for corrections). Marks the atomic task
// completed and credits task_points to employee_point_ledger, both inside
// one transaction, so a task is never "completed" without its points (or
// vice versa). Metric-mode items complete automatically via PATCH's
// current>=target check and are rejected here.
//
// Tiered review (Pillar 2, 2026-08-08): tasks worth more than the review
// threshold don't complete here at all — they move to `in_review` and wait for
// a Lead (POST /work-items/:id/review). The employee's action is identical
// either way ("Complete"); only the resulting state differs.

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const workItem = await prisma.workItem.findUnique({
    where: { id: params.id },
    include: { subUnit: { include: { workUnit: true } } },
  });
  if (!workItem || workItem.deletedAt) return failFor(ErrorCode.NOT_FOUND);

  if (session.employeeId !== workItem.assignedTo) {
    return failFor(ErrorCode.FORBIDDEN, "Only the assigned employee can complete this task.");
  }
  if (workItem.mode !== WorkItemMode.atomic) {
    return failFor(ErrorCode.VALIDATION, "Only atomic-mode WorkItems are completed via this endpoint.");
  }
  if (workItem.status === WorkItemStatus.completed) {
    return failFor(ErrorCode.CONFLICT, "This task is already completed.");
  }
  if (workItem.status === WorkItemStatus.in_review) {
    return failFor(ErrorCode.CONFLICT, "This task is already submitted and waiting on review.");
  }
  if (!(await isClockedInNow(session.employeeId!))) {
    return fail(ErrorCode.VALIDATION, "You must be clocked in to complete this task.", 422);
  }

  // Above the threshold — or self-logged at any size: hand off to the Lead
  // instead of crediting. No ledger
  // row is written, so nothing here can double-credit — acceptance does that.
  if (requiresReviewForItem(workItem)) {
    const submitted = await prisma.workItem.update({
      where: { id: workItem.id },
      // Clear any earlier review verdict so a resubmitted task doesn't show the
      // Lead a stale "sent back because…" note while it waits again.
      data: {
        status: WorkItemStatus.in_review,
        submittedAt: new Date(),
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: null,
      },
    });
    const assignee = await prisma.employee.findUnique({
      where: { id: workItem.assignedTo },
      select: { fullName: true },
    });
    await notifyReviewSubmitted(
      workItem.subUnit.workUnit.projectLeadId,
      assignee?.fullName ?? "An employee",
      workItem.title,
    );
    return ok({ workItem: submitted, pointsCredited: null, awaitingReview: true });
  }

  // The ledger's unique(work_item_id) constraint is the real guard against a
  // concurrent double-complete: if two requests both pass the status check
  // above, only one ledger insert succeeds — the other rolls back the whole
  // transaction (P2002) and we report the conflict rather than double-crediting.
  let updated;
  try {
    [updated] = await prisma.$transaction([
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
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return failFor(ErrorCode.CONFLICT, "This task is already completed.");
    }
    throw err;
  }

  return ok({ workItem: updated, pointsCredited: workItem.taskPoints, awaitingReview: false });
}
