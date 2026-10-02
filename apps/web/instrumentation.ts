// Next.js instrumentation hook — runs once when the server process boots.
// We use it to start the in-process cron scheduler (recognition snapshots,
// birthday checks, meeting reminders). Guarded to the Node.js runtime so it
// never tries to load node-cron in the Edge runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Fail fast on missing/placeholder secrets (fatal in production only).
    const { validateEnv } = await import("@/lib/env");
    validateEnv();

    const { refreshRoleRegistry } = await import("@/lib/rbac");
    await refreshRoleRegistry();

    // Blue/green containers overlap briefly. The VPS uses one host cron caller
    // for both slots, so neither container may schedule jobs independently.
    if (process.env.SCHEDULER_ENABLED !== "false") {
      const { startScheduler } = await import("@/lib/cron/scheduler");
      startScheduler();
    }
  }
}
