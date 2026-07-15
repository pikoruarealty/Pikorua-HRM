import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { runBirthdayCheck } from "@/lib/cron/birthday";

// Track B. POST /api/v1/cron/birthday-check — Milestone 3.5.
// CRON_SECRET-gated HTTP entry point; the actual logic lives in
// lib/cron/birthday.ts so the in-process scheduler (instrumentation.ts) can
// run the same job without HTTP. External crontab callers still work.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return failFor(ErrorCode.UNAUTHENTICATED, "Invalid or missing cron secret.");
  }

  const result = await runBirthdayCheck();
  return ok(result);
}
