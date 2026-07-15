import { describe, expect, test } from "bun:test";
import { collectEnvProblems } from "./env";

const GOOD = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  AUTH_SECRET: "a-genuinely-long-random-secret-string-0123456789",
  CRON_SECRET: "another-real-secret-value",
} as NodeJS.ProcessEnv;

describe("collectEnvProblems", () => {
  test("clean env has no problems", () => {
    expect(collectEnvProblems(GOOD)).toEqual([]);
  });

  test("missing DATABASE_URL and AUTH_SECRET are fatal", () => {
    const problems = collectEnvProblems({} as NodeJS.ProcessEnv);
    const fatal = problems.filter((p) => p.level === "fatal");
    expect(fatal.length).toBeGreaterThanOrEqual(2);
  });

  test("placeholder AUTH_SECRET from .env.example is fatal", () => {
    const problems = collectEnvProblems({
      ...GOOD,
      AUTH_SECRET: "change-me-to-a-long-random-secret",
    });
    expect(problems.some((p) => p.level === "fatal" && p.message.includes("AUTH_SECRET"))).toBe(true);
  });

  test("short AUTH_SECRET is fatal", () => {
    const problems = collectEnvProblems({ ...GOOD, AUTH_SECRET: "tooshort" });
    expect(problems.some((p) => p.level === "fatal" && p.message.includes("32"))).toBe(true);
  });

  test("placeholder CRON_SECRET only warns", () => {
    const problems = collectEnvProblems({ ...GOOD, CRON_SECRET: "change-me-cron-secret" });
    expect(problems).toHaveLength(1);
    expect(problems[0].level).toBe("warn");
  });
});
