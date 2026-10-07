import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { runDeviceSync } from "@/lib/integrations/teamoffice/sync";
import { createLogger } from "@/lib/log";

const logger = createLogger("teamoffice");

// POST /api/v1/cron/device-sync — CRON_SECRET-gated HTTP entry point
// (2026-08-12, Phase 28). Polls TeamOffice's incremental DownloadLastPunchData
// endpoint, ingests any new punches, and reconciles the days they touch into
// attendance_sessions.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return failFor(ErrorCode.UNAUTHENTICATED, "Invalid or missing cron secret.");
  }

  // A vendor/DB failure is answered with the reason (the host cron script logs
  // the body) instead of Next's bare 500, which hid why the sync had stopped.
  try {
    return ok(await runDeviceSync());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("device sync run failed", { error: message });
    return failFor(ErrorCode.INTERNAL, `Device sync failed: ${message}`);
  }
}
