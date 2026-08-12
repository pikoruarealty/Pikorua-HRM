import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { runDeviceSync } from "@/lib/integrations/teamoffice/sync";

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

  const result = await runDeviceSync();
  return ok(result);
}
