import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { Prisma, WorkItemStatus } from "@prisma/client";
import { notifyReviewAccepted, notifyReviewRejected } from "@/lib/work/notify";
import { maxAwardablePoints } from "@/lib/work/review";
import { audit, clientIp } from "@/lib/audit";

// POST /api/v1/work-items/:id/review — the Lead side of tiered point crediting
// (Pillar 2, 2026-08-08). Only reachable for items sitting in `in_review`.
//
//   accept → status becomes `completed` and points hit employee_point_ledger,
//            in one transaction (same invariant as the complete route: a task
//            is never completed without its points).
//   reject → status goes back to `wip` so the assignee can pick it up again.
//
// Audited: acceptance writes to the points ledger, which feeds recognition and
// (via the composite score) performance — the same "sensitive data" bar as
// request approvals.

const reviewSchema = z
  .object({
    action: z.enum(["accept", "reject"]),
    // Award fewer (or more) points than the task's nominal size. Omitted =
    // credit taskPoints as-is.
    points: z.number().int().positive().optional(),
    note: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const workItem = await prisma.workItem.findUnique({
    where: { id: params.id },
    include: { subUnit: { include: { workUnit: true } } },
  });
  if (!workItem || workItem.deletedAt) return failFor(ErrorCode.NOT_FOUND);

  // Same authority as editing the item: the WorkUnit's project lead, or Admin/HR.
  const isProjectLead = session.employeeId === workItem.subUnit.workUnit.projectLeadId;
  if (!isFinanceRole(session.role) && !isProjectLead) {
    return failFor(ErrorCode.FORBIDDEN, "Only this project's lead can review its tasks.");
  }
  if (workItem.status !== WorkItemStatus.in_review) {
    return failFor(ErrorCode.CONFLICT, "This task is not waiting on review.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
  }
  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return failFor(
      ErrorCode.VALIDATION,
      issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "Invalid request body.",
    );
  }
  const { action, points, note } = parsed.data;
  // Catalog self-logged work (2026-08-10) is deliberately not negotiable at
  // review: the employee picked a type from the Admin-set catalog and the
  // type's points are the whole answer. The Lead's question here is "did this
  // happen, yes or no" — a question a non-technical Lead can answer. Letting
  // them re-price it would smuggle difficulty-judgement back in through the
  // review screen, which is exactly what the catalog exists to avoid.
  // (The review-queue UI always sends `points`, pre-filled from taskPoints, so
  // this only rejects an actual deviation — not every accept.)
  if (
    workItem.selfLogged &&
    workItem.adhocTypeId &&
    points !== undefined &&
    points !== workItem.taskPoints
  ) {
    return failFor(
      ErrorCode.VALIDATION,
      "A self-logged task is worth its type's points — accept it or send it back, but don't re-price it.",
    );
  }
  // Free-text self-logged work (2026-08-14) is priced by Groq at creation
  // time (see estimateSelfLoggedTaskPoints), same as any other task — it only
  // reaches this route at all when that estimate is above the review
  // threshold, and from there it behaves like an ordinary review: accept the
  // AI's number as-is, or override it with a note like the ceiling check
  // below already requires for any other task.
  const nominal = workItem.taskPoints ?? 0;
  const awarded = points ?? nominal;

  // Rewarding outsized effort is allowed; minting points is not. Without this
  // ceiling one accepted review could set the department's Output benchmark
  // single-handedly and hand its author Employee of the Month.
  const ceiling = maxAwardablePoints(nominal);
  if (points !== undefined && points > ceiling) {
    return failFor(
      ErrorCode.VALIDATION,
      `A ${nominal}-point task can be credited at most ${ceiling} points. Re-size the task if it was worth more.`,
    );
  }

  // A reason is mandatory whenever the outcome is worse for the assignee than
  // simply "accepted as submitted" — sending it back, or paying out less.
  if (action === "reject" && !note) {
    return failFor(ErrorCode.VALIDATION, "note is required when sending a task back.");
  }
  if (action === "accept" && awarded < nominal && !note) {
    return failFor(ErrorCode.VALIDATION, "note is required when crediting fewer points than the task is worth.");
  }
  // Paying *above* nominal is a judgement call that should leave a trace too,
  // so the next person to read the ledger knows why the numbers disagree.
  if (action === "accept" && awarded > nominal && !note) {
    return failFor(ErrorCode.VALIDATION, "note is required when crediting more points than the task is worth.");
  }

  const now = new Date();

  if (action === "reject") {
    const updated = await prisma.workItem.update({
      where: { id: workItem.id },
      data: {
        status: WorkItemStatus.wip,
        reviewedBy: session.employeeId,
        reviewedAt: now,
        reviewNote: note ?? null,
        // Not completed, so no completedAt; submittedAt stays as the record of
        // when it was first handed in.
        completedAt: null,
      },
    });
    await notifyReviewRejected(workItem.assignedTo, workItem.title, note!);
    await audit({
      action: "work_item.review_reject",
      actorUserId: session.userId,
      actorRole: session.role,
      entityType: "work_item",
      entityId: workItem.id,
      metadata: { status: updated.status, assigneeId: workItem.assignedTo, note },
      ip: clientIp(req),
    });
    return ok(updated);
  }

  // Accept. The ledger's unique(work_item_id) constraint is still the real
  // guard — if this races another crediting path, the loser rolls back whole.
  let updated;
  try {
    [updated] = await prisma.$transaction([
      prisma.workItem.update({
        where: { id: workItem.id },
        data: {
          status: WorkItemStatus.completed,
          completedAt: now,
          reviewedBy: session.employeeId,
          reviewedAt: now,
          reviewNote: note ?? null,
        },
      }),
      prisma.employeePointLedger.create({
        data: { employeeId: workItem.assignedTo, workItemId: workItem.id, points: awarded },
      }),
    ]);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return failFor(ErrorCode.CONFLICT, "This task has already been credited.");
    }
    throw err;
  }

  await notifyReviewAccepted(workItem.assignedTo, workItem.title, awarded, note ?? null);
  await audit({
    action: "work_item.review_accept",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "work_item",
    entityId: workItem.id,
    metadata: {
      status: updated.status,
      assigneeId: workItem.assignedTo,
      pointsCredited: awarded,
      nominalPoints: nominal,
      note: note ?? null,
    },
    ip: clientIp(req),
  });

  return ok({ workItem: updated, pointsCredited: awarded, awaitingReview: false });
}
