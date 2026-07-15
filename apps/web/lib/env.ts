// Boot-time environment validation (production hardening, 2026-07-15).
// Called from instrumentation.ts before the cron scheduler starts. In
// production a missing/placeholder secret is fatal — better to refuse to
// boot than to run an HR system signed with "change-me". In development we
// warn instead so local setup stays frictionless.

const PLACEHOLDER_FRAGMENTS = ["change-me", "changeme", "example", "placeholder"];

type Problem = { level: "fatal" | "warn"; message: string };

function looksLikePlaceholder(value: string): boolean {
  const v = value.toLowerCase();
  return PLACEHOLDER_FRAGMENTS.some((f) => v.includes(f));
}

export function collectEnvProblems(env: NodeJS.ProcessEnv): Problem[] {
  const problems: Problem[] = [];

  if (!env.DATABASE_URL) {
    problems.push({ level: "fatal", message: "DATABASE_URL is not set." });
  }

  const authSecret = env.AUTH_SECRET ?? "";
  if (!authSecret) {
    problems.push({ level: "fatal", message: "AUTH_SECRET is not set." });
  } else if (looksLikePlaceholder(authSecret)) {
    problems.push({
      level: "fatal",
      message: "AUTH_SECRET looks like the .env.example placeholder — generate a real one (openssl rand -base64 48).",
    });
  } else if (authSecret.length < 32) {
    problems.push({
      level: "fatal",
      message: `AUTH_SECRET is only ${authSecret.length} chars — use at least 32 (openssl rand -base64 48).`,
    });
  }

  const cronSecret = env.CRON_SECRET ?? "";
  if (!cronSecret || looksLikePlaceholder(cronSecret)) {
    problems.push({
      level: "warn",
      message: "CRON_SECRET is unset or a placeholder — the /api/v1/cron/* routes are guessable until it is set.",
    });
  }

  return problems;
}

/** Validate env at boot. Throws in production on fatal problems; logs
 *  warnings otherwise. */
export function validateEnv(): void {
  const problems = collectEnvProblems(process.env);
  const isProd = process.env.NODE_ENV === "production";

  for (const p of problems) {
    const tag = p.level === "fatal" ? "[env] FATAL" : "[env] warning";
    console.error(`${tag}: ${p.message}`);
  }

  const fatals = problems.filter((p) => p.level === "fatal");
  if (isProd && fatals.length > 0) {
    throw new Error(
      `Refusing to start: ${fatals.length} fatal environment problem(s) — see log above.`,
    );
  }
}
