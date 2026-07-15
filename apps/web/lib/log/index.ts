// Verbose structured logging (2026-07-15). One tiny console-based logger used
// across the app so every significant thing the system does leaves a
// timestamped, greppable line on the server console:
//
//   [2026-07-15T11:42:03.512Z] INFO  [api] request rid=… method=GET path=/api/v1/employees
//   [2026-07-15T11:42:03.548Z] WARN  [api] response FORBIDDEN (403): You do not have access…
//   [2026-07-15T11:42:04.101Z] INFO  [audit] payslip.generate entity=payslip:… actor=…
//
// Instrumented call sites:
//   - middleware.ts          → every incoming request (method, path, ip, request id)
//   - lib/api/response.ts    → every API failure (warn; 5xx as error) and success (debug)
//   - lib/audit/index.ts     → every audited sensitive mutation (info)
//   - feature routes/cron    → ad-hoc domain lines via createLogger("<scope>")
//
// Deliberately console-only (no file handles, no deps) so it is safe in both
// the Node and Edge runtimes. Level controlled by LOG_LEVEL (debug | info |
// warn | error); defaults to debug in development and info in production.

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function activeThreshold(): number {
  const configured = (process.env.LOG_LEVEL ?? "").toLowerCase() as LogLevel;
  if (configured in LEVEL_ORDER) return LEVEL_ORDER[configured];
  return process.env.NODE_ENV === "production" ? LEVEL_ORDER.info : LEVEL_ORDER.debug;
}

/** Serialize metadata defensively — a logging call must never throw. */
function safeMeta(meta: unknown): string {
  try {
    return JSON.stringify(meta, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  } catch {
    return '"<unserializable meta>"';
  }
}

export function log(level: LogLevel, scope: string, message: string, meta?: unknown): void {
  if (LEVEL_ORDER[level] < activeThreshold()) return;
  const line = `[${new Date().toISOString()}] ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
  const writer = level === "debug" ? console.log : console[level];
  if (meta !== undefined) {
    writer(line, safeMeta(meta));
  } else {
    writer(line);
  }
}

export type Logger = {
  debug: (message: string, meta?: unknown) => void;
  info: (message: string, meta?: unknown) => void;
  warn: (message: string, meta?: unknown) => void;
  error: (message: string, meta?: unknown) => void;
};

/** Scoped logger factory: `const logger = createLogger("attendance")`. */
export function createLogger(scope: string): Logger {
  return {
    debug: (message, meta) => log("debug", scope, message, meta),
    info: (message, meta) => log("info", scope, message, meta),
    warn: (message, meta) => log("warn", scope, message, meta),
    error: (message, meta) => log("error", scope, message, meta),
  };
}
