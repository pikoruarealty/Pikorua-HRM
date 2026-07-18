import cron from "node-cron";
import { RecognitionPeriodType } from "@prisma/client";
import { runRecognitionSnapshot } from "@/lib/cron/recognition";
import { runBirthdayCheck } from "@/lib/cron/birthday";
import { runMeetingReminders } from "@/lib/cron/meeting-reminders";
import { runMetricDailyRollover } from "@/lib/cron/metric-daily-rollover";

// In-process scheduler (PRD §6 — "a lightweight scheduled-jobs mechanism").
// Registered once at server boot from instrumentation.ts. Assumes a single
// running server instance (the GCP-VM deployment target); if the app is ever
// horizontally scaled, move these to an external crontab hitting the
// CRON_SECRET-gated HTTP routes instead (which still exist and are unchanged).

let started = false;

function safeRun(name: string, fn: () => Promise<unknown>) {
  fn()
    .then((res) => {
      console.log(`[cron] ${name} ok`, res);
    })
    .catch((err) => {
      console.error(`[cron] ${name} failed`, err);
    });
}

export function startScheduler(): void {
  // Guard against double-registration (Next can call register() more than once
  // across HMR / multiple entrypoints in dev).
  if (started) return;
  started = true;

  // Meeting reminders — every 5 minutes. Idempotent per (user, meeting).
  cron.schedule("*/5 * * * *", () => {
    safeRun("meeting-reminders", () => runMeetingReminders());
  });

  // Birthday / anniversary shoutout — daily at 00:05 UTC.
  cron.schedule("5 0 * * *", () => {
    safeRun("birthday-check", () => runBirthdayCheck());
  });

  // Metric daily-frequency rollover — daily at 00:10 UTC, before recognition.
  cron.schedule("10 0 * * *", () => {
    safeRun("metric-daily-rollover", () => runMetricDailyRollover());
  });

  // Recognition weekly snapshot — Mondays 00:15 UTC.
  cron.schedule("15 0 * * 1", () => {
    safeRun("recognition-weekly", () =>
      runRecognitionSnapshot({ periodType: RecognitionPeriodType.weekly }),
    );
  });

  // Recognition monthly snapshot — 1st of month 00:20 UTC.
  cron.schedule("20 0 1 * *", () => {
    safeRun("recognition-monthly", () =>
      runRecognitionSnapshot({ periodType: RecognitionPeriodType.monthly }),
    );
  });

  console.log("[cron] in-process scheduler started");
}
