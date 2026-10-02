import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { runMetricDailyRollover } from "@/lib/cron/metric-daily-rollover";

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return failFor(ErrorCode.UNAUTHENTICATED, "Invalid or missing cron secret.");
  }
  return ok(await runMetricDailyRollover());
}
