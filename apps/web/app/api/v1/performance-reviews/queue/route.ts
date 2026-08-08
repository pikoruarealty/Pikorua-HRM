import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { getReviewableEmployees } from "@/lib/performance/authority";
import {
  currentPeriod,
  isBeforeJoining,
  isFuturePeriod,
  periodLabel,
} from "@/lib/performance/review";

// GET /api/v1/performance-reviews/queue?year=&month= — the Lead's monthly
// review worklist (Pillar 3, 2026-08-08): every employee they may review for
// the period, each with the review they've already written for it, or null.
//
// Self-scoping, same shape as GET /work-items/review-queue: Admin/HR get the
// whole company, a Lead gets their own team members, anyone else gets an empty
// list rather than a 403 — the page simply has nothing on it.
//
// The `review` on each row is only ever the *caller's own* review. Another
// Lead's or Admin's rating of the same person is deliberately not shown here;
// the full multi-reviewer history lives on the employee's profile.

const querySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return failFor(ErrorCode.VALIDATION, "Invalid query parameters.");
  }

  const fallback = currentPeriod();
  const period = {
    periodYear: parsed.data.year ?? fallback.periodYear,
    periodMonth: parsed.data.month ?? fallback.periodMonth,
  };
  if (isFuturePeriod(period)) {
    return failFor(ErrorCode.VALIDATION, `${periodLabel(period)} hasn't started yet.`);
  }

  const employees = await getReviewableEmployees(session);
  if (employees.length === 0 || !session.employeeId) {
    return ok({
      period: { ...period, label: periodLabel(period) },
      summary: { reviewable: 0, reviewed: 0, pending: 0 },
      employees: [],
    });
  }

  const reviews = await prisma.performanceReview.findMany({
    where: {
      reviewerId: session.employeeId,
      periodYear: period.periodYear,
      periodMonth: period.periodMonth,
      employeeId: { in: employees.map((e) => e.id) },
    },
  });
  const reviewByEmployee = new Map(reviews.map((r) => [r.employeeId, r]));

  const rows = employees.map((e) => {
    const review = reviewByEmployee.get(e.id);
    return {
      id: e.id,
      fullName: e.fullName,
      role: e.role,
      teamName: e.team?.name ?? null,
      photoUrl: e.photoUrl ? `/api/v1/employees/${e.id}/photo` : null,
      // A hire who joined after this month can't be rated for it — surfaced as
      // a flag so the UI can explain the disabled row instead of 422-ing on save.
      joinedAfterPeriod: isBeforeJoining(period, e.dateOfJoining),
      review: review
        ? { id: review.id, rating: review.rating, note: review.note, updatedAt: review.updatedAt }
        : null,
    };
  });

  const reviewable = rows.filter((r) => !r.joinedAfterPeriod);
  const reviewed = reviewable.filter((r) => r.review !== null).length;

  return ok({
    period: { ...period, label: periodLabel(period) },
    summary: {
      reviewable: reviewable.length,
      reviewed,
      pending: reviewable.length - reviewed,
    },
    employees: rows,
  });
}
