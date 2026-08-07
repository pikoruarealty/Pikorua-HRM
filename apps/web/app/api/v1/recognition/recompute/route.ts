import { z } from "zod";
import { getSession } from "@/lib/auth";
import { Role } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { runRecognitionSnapshot } from "@/lib/cron/recognition";
import { RecognitionPeriodType } from "@prisma/client";

// Track B (owner request, 2026-08-07). POST /api/v1/recognition/recompute —
// Admin-only, session-based wrapper around the same runRecognitionSnapshot()
// the CRON_SECRET-gated /cron/recognition-snapshot route calls, so an admin
// can refresh the reference leaderboard from the UI on demand (before
// picking a winner to publish) without needing the cron secret. NOTE:
// recomputing wipes any already-published pick for the recomputed period —
// see the header comment in lib/cron/recognition.ts.

const bodySchema = z.object({
  periodType: z.nativeEnum(RecognitionPeriodType).optional(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (session.role !== Role.admin) return failFor(ErrorCode.FORBIDDEN);

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body ?? {});
  if (!parsed.success) return fail(ErrorCode.VALIDATION, "Invalid recompute payload.", 422);

  const results = await runRecognitionSnapshot({ periodType: parsed.data.periodType });
  return ok({ results });
}
