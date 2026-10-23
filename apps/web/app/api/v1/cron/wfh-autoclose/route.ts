import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { autoCloseOverlongWfhSessions } from "@/lib/attendance/wfh-autoclose";

// POST /api/v1/cron/wfh-autoclose — CRON_SECRET-gated HTTP entry point.
// Closes WFH sessions that have run past the per-session limit (see
// lib/attendance/wfh-autoclose.ts) so a forgotten clock-out never leaves a day
// open and unapprovable.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return failFor(ErrorCode.UNAUTHENTICATED, "Invalid or missing cron secret.");
  }

  const result = await autoCloseOverlongWfhSessions();
  return ok(result);
}
