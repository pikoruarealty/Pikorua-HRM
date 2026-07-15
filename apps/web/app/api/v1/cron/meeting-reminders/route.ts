import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { runMeetingReminders } from "@/lib/cron/meeting-reminders";

// Track B. POST /api/v1/cron/meeting-reminders — Milestone 3.5.
// CRON_SECRET-gated HTTP entry point; logic lives in
// lib/cron/meeting-reminders.ts so the in-process scheduler
// (instrumentation.ts) runs the same job. External crontab callers still work.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return failFor(ErrorCode.UNAUTHENTICATED, "Invalid or missing cron secret.");
  }

  const result = await runMeetingReminders();
  return ok(result);
}
