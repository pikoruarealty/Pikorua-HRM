import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { runAttendanceEodCleanup } from "@/lib/cron/attendance-eod-cleanup";

// POST /api/v1/cron/attendance-eod — CRON_SECRET-gated HTTP entry point.
// Cleans up dangling empty records and auto-populates default clock-out times
// for past days where employees clocked in but missed clocking out.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return failFor(ErrorCode.UNAUTHENTICATED, "Invalid or missing cron secret.");
  }

  const result = await runAttendanceEodCleanup();
  return ok(result);
}
