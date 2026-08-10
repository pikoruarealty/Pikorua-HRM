import { z } from "zod";
import { OfflineClaimStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { audit, clientIp } from "@/lib/audit";
import { resolveSalesScope, scopeToEmployeeIds } from "@/lib/sales/authority";
import { notifyOfflineClaimSubmitted } from "@/lib/sales/notify";

// Offline call claims (2026-08-10). Reps who work a raw Excel list make calls
// the CRM never sees. The owner's decision: the rep proposes, the Lead
// approves — the claim is worth nothing until then, so self-reporting alone can
// never inflate a score.
//
// GET  /api/v1/sales/offline-claims — scoped list (self / led teams / all).
// POST /api/v1/sales/offline-claims — the rep files a claim for themselves.

const createSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD."),
    calls: z.number().int().positive().max(500),
    // Mandatory: an unexplained claim is not reviewable, and the note is what a
    // Lead actually adjudicates on.
    note: z.string().trim().min(3).max(1000),
  })
  .strict();

/** Calls claimed for a day cannot exceed this. A cap is not the primary
 *  defence (Lead approval is) — it is a guard against a fat-fingered 1000. */
const MAX_CLAIM_PER_DAY = 500;

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const scope = await resolveSalesScope(session);
  if (!scope) return failFor(ErrorCode.FORBIDDEN, "No employee record linked to this account.");

  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get("status");
  const status =
    statusParam && (Object.values(OfflineClaimStatus) as string[]).includes(statusParam)
      ? (statusParam as OfflineClaimStatus)
      : undefined;

  const employeeIds = await scopeToEmployeeIds(scope);

  const claims = await prisma.offlineActivityClaim.findMany({
    where: { employeeId: { in: employeeIds }, ...(status ? { status } : {}) },
    include: {
      employee: { select: { id: true, fullName: true } },
      reviewer: { select: { id: true, fullName: true } },
    },
    orderBy: [{ createdAt: "desc" }],
    take: 200,
  });

  return ok(claims);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!session.employeeId) {
    return failFor(ErrorCode.FORBIDDEN, "No employee record linked to this account.");
  }
  const employeeId = session.employeeId;

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
  const { date: dateStr, calls, note } = parsed.data;

  const date = new Date(`${dateStr}T00:00:00.000Z`);
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  if (date > todayUtc) {
    return failFor(ErrorCode.VALIDATION, "Cannot claim calls for a future date.");
  }
  // Bound how far back a claim can reach, so a month cannot be quietly
  // rewritten after its score was published.
  const earliest = new Date(todayUtc.getTime() - 14 * 86_400_000);
  if (date < earliest) {
    return failFor(ErrorCode.VALIDATION, "Offline calls must be claimed within 14 days.");
  }

  // Sum what is already pending or approved for the day, so the cap cannot be
  // sidestepped by filing many small claims.
  const existing = await prisma.offlineActivityClaim.aggregate({
    where: {
      employeeId,
      date,
      status: { in: [OfflineClaimStatus.pending, OfflineClaimStatus.approved] },
    },
    _sum: { calls: true },
  });
  if ((existing._sum.calls ?? 0) + calls > MAX_CLAIM_PER_DAY) {
    return failFor(
      ErrorCode.VALIDATION,
      `Claims for one day cannot exceed ${MAX_CLAIM_PER_DAY} calls in total.`,
    );
  }

  const claim = await prisma.offlineActivityClaim.create({
    data: { employeeId, date, calls, note },
    include: { employee: { select: { id: true, fullName: true } } },
  });

  await notifyOfflineClaimSubmitted(employeeId, claim.employee.fullName, calls, dateStr);
  await audit({
    action: "sales.offline_claim_create",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "offline_activity_claim",
    entityId: claim.id,
    metadata: { employeeId, date: dateStr, calls, note },
    ip: clientIp(req),
  });

  return ok(claim, 201);
}
