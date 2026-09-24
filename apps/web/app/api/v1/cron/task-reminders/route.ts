import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { runTaskReminders } from "@/lib/cron/task-reminders";

// POST /api/v1/cron/task-reminders — CRON_SECRET-gated HTTP entry point;
// logic lives in lib/cron/task-reminders.ts so the in-process scheduler
// (instrumentation.ts) runs the same job. External crontab callers still work.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return failFor(ErrorCode.UNAUTHENTICATED, "Invalid or missing cron secret.");
  }

  const result = await runTaskReminders();
  return ok(result);
}
