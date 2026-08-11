import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { isUuid } from "@/lib/api/params";
import { audit, clientIp } from "@/lib/audit";
import { getReviewAccess } from "@/lib/performance/authority";
import {
  RATING_MAX,
  RATING_MIN,
  averageRating,
  currentPeriod,
  periodLabel,
  validatePeriod,
} from "@/lib/performance/review";

// Monthly Lead quality review for one employee (Pillar 3, 2026-08-08).
//
//   GET  — the review history. Readable by the employee themself, the Lead who
//          owns their team, and Admin/HR (same set as task-activity).
//   POST — record this month's rating. Owning Lead or Admin/HR, never self.
//          One row per (employee, reviewer, period): a repeat is a 409 telling
//          the caller to PATCH /performance-reviews/:id instead, so a rating is
//          never silently overwritten.
//
// There is no employee-facing workflow here by design — nothing is pushed at
// the employee, no notification, no acknowledgement step. They see it only if
// they open their own profile.

const createSchema = z
  .object({
    // Omitted = the month we're in. The UI always sends both explicitly.
    periodYear: z.number().int().min(2000).max(2100).optional(),
    periodMonth: z.number().int().min(1).max(12).optional(),
    rating: z.number().int().min(RATING_MIN).max(RATING_MAX),
    note: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!isUuid(params.id)) return failFor(ErrorCode.NOT_FOUND);

  const access = await getReviewAccess(session, params.id);
  if (!access) return failFor(ErrorCode.NOT_FOUND);
  if (!access.canRead) return failFor(ErrorCode.FORBIDDEN);

  const reviews = await prisma.performanceReview.findMany({
    where: { employeeId: access.employee.id },
    include: { reviewer: { select: { id: true, fullName: true } } },
    // Newest month first; ties (two reviewers, same month) by write order.
    orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }, { createdAt: "asc" }],
  });

  return ok({
    summary: {
      reviewCount: reviews.length,
      averageRating: averageRating(reviews.map((r) => r.rating)),
      latestRating: reviews[0]?.rating ?? null,
    },
    reviews: reviews.map((r) => ({
      id: r.id,
      periodYear: r.periodYear,
      periodMonth: r.periodMonth,
      periodLabel: periodLabel(r),
      rating: r.rating,
      note: r.note,
      reviewer: r.reviewer,
      // Whether *this* caller may correct this particular row — mirrors the
      // rule PATCH /performance-reviews/:id enforces server-side.
      canEdit: access.canWrite && (session.role === "admin" || r.reviewerId === session.employeeId),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!isUuid(params.id)) return failFor(ErrorCode.NOT_FOUND);
  if (!session.employeeId) {
    return failFor(ErrorCode.FORBIDDEN, "Only an employee record can author a review.");
  }

  const access = await getReviewAccess(session, params.id);
  if (!access) return failFor(ErrorCode.NOT_FOUND);
  if (!access.canWrite) {
    return failFor(
      ErrorCode.FORBIDDEN,
      access.isSelf
        ? "You cannot review yourself."
        : "Only this employee's lead can review them.",
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return failFor(
      ErrorCode.VALIDATION,
      issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "Invalid request body.",
    );
  }
  const { rating, note } = parsed.data;

  const fallback = currentPeriod();
  const period = {
    periodYear: parsed.data.periodYear ?? fallback.periodYear,
    periodMonth: parsed.data.periodMonth ?? fallback.periodMonth,
  };
  const periodError = validatePeriod(period, access.employee.dateOfJoining);
  if (periodError) return failFor(ErrorCode.VALIDATION, periodError);

  let review;
  try {
    review = await prisma.performanceReview.create({
      data: {
        employeeId: access.employee.id,
        reviewerId: session.employeeId,
        periodYear: period.periodYear,
        periodMonth: period.periodMonth,
        rating,
        note: note ?? null,
      },
      include: { reviewer: { select: { id: true, fullName: true } } },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return failFor(
        ErrorCode.CONFLICT,
        `You have already reviewed ${access.employee.fullName} for ${periodLabel(period)}. Edit that review instead.`,
      );
    }
    throw err;
  }

  // Audited: this rating feeds the composite performance score (Pillar 6), so
  // it sits at the same sensitivity bar as a points credit.
  await audit({
    action: "performance_review.create",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "performance_review",
    entityId: review.id,
    metadata: {
      employeeId: access.employee.id,
      periodYear: period.periodYear,
      periodMonth: period.periodMonth,
      rating,
      hasNote: note != null,
    },
    ip: clientIp(req),
  });

  return ok(
    {
      id: review.id,
      periodYear: review.periodYear,
      periodMonth: review.periodMonth,
      periodLabel: periodLabel(review),
      rating: review.rating,
      note: review.note,
      reviewer: review.reviewer,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
    },
    201,
  );
}
