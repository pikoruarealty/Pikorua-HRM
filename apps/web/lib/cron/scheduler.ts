import cron from "node-cron";
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

  // Birthday / anniversary / custom-event shoutout — daily at 00:05 UTC, plus
  // an immediate run at boot as a catch-up. Since runBirthdayCheck() is now
  // idempotent per user/message/day (2026-08-08), a boot-time run costs
  // nothing on a day it already fired, but recovers same-day shoutouts that
  // would otherwise be silently lost if the process wasn't up at 00:05 (a
  // dev restart or redeploy) — this was reported as "saw it on the calendar,
  // never got the notification."
  cron.schedule("5 0 * * *", () => {
    safeRun("birthday-check", () => runBirthdayCheck());
  });
  safeRun("birthday-check-boot-catchup", () => runBirthdayCheck());

  // Metric daily-frequency rollover — daily at 00:10 UTC, before recognition.
  cron.schedule("10 0 * * *", () => {
    safeRun("metric-daily-rollover", () => runMetricDailyRollover());
  });

  // Recognition weekly/monthly snapshots are no longer auto-scheduled
  // (2026-08-07) — "Employee of the Week/Month" is now an Admin-only manual
  // pick (see POST /recognition/publish). runRecognitionSnapshot() stays
  // callable on demand via POST /recognition/recompute so an admin can
  // refresh the reference leaderboard before picking a winner.

  console.log("[cron] in-process scheduler started");
}
