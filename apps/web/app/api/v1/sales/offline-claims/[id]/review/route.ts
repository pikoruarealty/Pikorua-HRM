import { z } from "zod";
import { OfflineClaimStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { audit, clientIp } from "@/lib/audit";
import { canReviewClaimsFor } from "@/lib/sales/authority";
import { notifyOfflineClaimReviewed } from "@/lib/sales/notify";
import { syncEmployeeMetrics } from "@/lib/sales/write-through";

// POST /api/v1/sales/offline-claims/:id/review — the Lead half of "rep
// proposes, Lead approves" (2026-08-10).
//
// Approving is what makes an offline claim count for anything: only then does
// it enter the day's call total. The write-through recomputes that total from
// scratch (CRM + approved claims) rather than incrementing, so approving a
// claim hours or days late lands on exactly the same number as approving it
// immediately.
//
// Audited, because this credits activity that feeds the composite performance
// score — the same bar as work_item.review_accept.

const reviewSchema = z
  .object({
    action: z.enum(["approve", "reject"]),
    note: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const claim = await prisma.offlineActivityClaim.findUnique({
    where: { id: params.id },
    include: { employee: { select: { id: true, fullName: true } } },
  });
  if (!claim) return failFor(ErrorCode.NOT_FOUND);

  // Self-approval is refused even for an Admin who filed their own claim —
  // "rep proposes, Lead approves" is the entire anti-gaming mechanism.
  if (!(await canReviewClaimsFor(session, claim.employeeId))) {
    return failFor(ErrorCode.FORBIDDEN, "Only this employee's lead (or Admin/HR) can review their claims.");
  }
  if (claim.status !== OfflineClaimStatus.pending) {
    return failFor(ErrorCode.CONFLICT, "This claim has already been reviewed.");
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
  const { action, note } = parsed.data;

  if (action === "reject" && !note) {
    return failFor(ErrorCode.VALIDATION, "note is required when declining a claim.");
  }

  const approved = action === "approve";
  const updated = await prisma.offlineActivityClaim.update({
    where: { id: claim.id },
    data: {
      status: approved ? OfflineClaimStatus.approved : OfflineClaimStatus.rejected,
      reviewedBy: session.employeeId,
      reviewedAt: new Date(),
      reviewNote: note ?? null,
    },
  });

  // Only an approval changes the day's total, but recomputing on rejection too
  // costs one query and keeps the WorkItem authoritative if an earlier
  // approval is ever reversed.
  await syncEmployeeMetrics(claim.employeeId, claim.date);

  const dateStr = claim.date.toISOString().slice(0, 10);
  await notifyOfflineClaimReviewed(claim.employeeId, approved, claim.calls, dateStr, note ?? null);
  await audit({
    action: approved ? "sales.offline_claim_approve" : "sales.offline_claim_reject",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "offline_activity_claim",
    entityId: claim.id,
    metadata: {
      employeeId: claim.employeeId,
      date: dateStr,
      calls: claim.calls,
      claimNote: claim.note,
      reviewNote: note ?? null,
    },
    ip: clientIp(req),
  });

  return ok(updated);
}
