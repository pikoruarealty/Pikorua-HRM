// In-memory sliding-window rate limiter (production hardening, 2026-07-15).
// Used for login brute-force protection and other abuse-prone endpoints.
//
// Single-instance by design: state lives in process memory, which matches
// this app's deployment target (one Next.js process on one GCP VM — the same
// assumption the in-process cron scheduler already makes). If the app ever
// scales to multiple instances, swap the Map for Redis behind this same
// interface.

type WindowEntry = { timestamps: number[] };

const buckets = new Map<string, WindowEntry>();

// Periodic sweep so abandoned keys don't accumulate forever. Guarded so the
// interval is created once per process and never keeps the process alive.
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
let sweeper: ReturnType<typeof setInterval> | null = null;

function ensureSweeper(windowMs: number) {
  if (sweeper) return;
  sweeper = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, entry] of buckets) {
      entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
      if (entry.timestamps.length === 0) buckets.delete(key);
    }
  }, SWEEP_INTERVAL_MS);
  if (typeof sweeper.unref === "function") sweeper.unref();
}

export type RateLimitOptions = {
  /** Max attempts allowed inside the window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Injectable clock for tests. */
  now?: () => number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** Seconds until the oldest attempt falls out of the window (when blocked). */
  retryAfterSeconds: number;
};

/** Record an attempt for `key` and report whether it is within the limit. */
export function checkRateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = opts.now ? opts.now() : Date.now();
  const cutoff = now - opts.windowMs;
  ensureSweeper(opts.windowMs);

  const entry = buckets.get(key) ?? { timestamps: [] };
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= opts.max) {
    buckets.set(key, entry);
    const oldest = entry.timestamps[0];
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + opts.windowMs - now) / 1000)),
    };
  }

  entry.timestamps.push(now);
  buckets.set(key, entry);
  return {
    allowed: true,
    remaining: opts.max - entry.timestamps.length,
    retryAfterSeconds: 0,
  };
}

/** Clear a key (e.g. after a successful login, so a legitimate user who
 *  fumbled their password a few times isn't still carrying strikes). */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}
