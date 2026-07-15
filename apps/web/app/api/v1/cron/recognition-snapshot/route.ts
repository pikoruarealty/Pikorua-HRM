import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { runRecognitionSnapshot } from "@/lib/cron/recognition";
import { RecognitionPeriodType } from "@prisma/client";

// Track B. POST /api/v1/cron/recognition-snapshot — Milestone 3.1.
// CRON_SECRET-gated HTTP entry point; the scoring/idempotency logic lives in
// lib/cron/recognition.ts so the in-process scheduler (instrumentation.ts)
// runs the same job. Optional ?period_type= and ?period_start= overrides are
// preserved for manual/external invocation.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return failFor(ErrorCode.UNAUTHENTICATED, "Invalid or missing cron secret.");
  }

  const url = new URL(req.url);
  const periodTypeParam = url.searchParams.get("period_type");
  const periodStartParam = url.searchParams.get("period_start");

  if (
    periodTypeParam &&
    !Object.values(RecognitionPeriodType).includes(periodTypeParam as RecognitionPeriodType)
  ) {
    return failFor(ErrorCode.VALIDATION, "period_type must be 'weekly' or 'monthly'.");
  }

  let periodStart: Date | undefined;
  if (periodStartParam) {
    periodStart = new Date(periodStartParam);
    if (Number.isNaN(periodStart.getTime())) {
      return failFor(ErrorCode.VALIDATION, "period_start must be a valid date.");
    }
  }

  const results = await runRecognitionSnapshot({
    periodType: periodTypeParam ? (periodTypeParam as RecognitionPeriodType) : undefined,
    periodStart,
  });

  return ok({ results });
}
