import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { audit, clientIp } from "@/lib/audit";
import { RATING_MAX, RATING_MIN, periodLabel } from "@/lib/performance/review";

// PATCH /api/v1/performance-reviews/:id — correct a review you wrote.
//
// Creating is a 409 on a repeat (see POST /employees/:id/performance-review),
// so this is the only way a rating changes after the fact. Restricted to the
// review's own author, plus Admin as the standing manual-override role: a Lead
// must never be able to quietly rewrite another Lead's read of the same month.
// Both the before and after values go into the audit trail.

const patchSchema = z
  .object({
    rating: z.number().int().min(RATING_MIN).max(RATING_MAX).optional(),
    // Explicit null clears the note; omitting it leaves the note untouched.
    note: z.string().trim().min(1).max(2000).nullable().optional(),
  })
  .strict()
  .refine((v) => v.rating !== undefined || v.note !== undefined, {
    message: "Provide at least one of rating or note.",
  });

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const existing = await prisma.performanceReview.findUnique({
    where: { id: params.id },
    include: { employee: { select: { id: true, fullName: true } } },
  });
  if (!existing) return failFor(ErrorCode.NOT_FOUND);

  const isAuthor = session.employeeId != null && session.employeeId === existing.reviewerId;
  if (!isAuthor && !isAdmin(session.role)) {
    return failFor(ErrorCode.FORBIDDEN, "Only the review's author can edit it.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return failFor(
      ErrorCode.VALIDATION,
      issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "Invalid request body.",
    );
  }
  const { rating, note } = parsed.data;

  const updated = await prisma.performanceReview.update({
    where: { id: existing.id },
    data: {
      ...(rating !== undefined ? { rating } : {}),
      ...(note !== undefined ? { note } : {}),
    },
    include: { reviewer: { select: { id: true, fullName: true } } },
  });

  await audit({
    action: "performance_review.update",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "performance_review",
    entityId: updated.id,
    metadata: {
      employeeId: existing.employeeId,
      periodYear: existing.periodYear,
      periodMonth: existing.periodMonth,
      previousRating: existing.rating,
      rating: updated.rating,
      noteChanged: note !== undefined,
      // An Admin fixing someone else's review is the case worth spotting later.
      editedByAuthor: isAuthor,
      authorEmployeeId: existing.reviewerId,
    },
    ip: clientIp(req),
  });

  return ok({
    id: updated.id,
    periodYear: updated.periodYear,
    periodMonth: updated.periodMonth,
    periodLabel: periodLabel(updated),
    rating: updated.rating,
    note: updated.note,
    reviewer: updated.reviewer,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  });
}
