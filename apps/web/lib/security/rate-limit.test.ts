import { describe, expect, test } from "bun:test";
import { checkRateLimit, resetRateLimit } from "./rate-limit";

// Each test uses its own key (the limiter is module-level state) and an
// injected clock so nothing here depends on wall time.
const WINDOW = 60_000;

describe("checkRateLimit", () => {
  test("allows up to max attempts, then blocks", () => {
    const key = "test:block";
    const now = () => 1_000_000;
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit(key, { max: 3, windowMs: WINDOW, now }).allowed).toBe(true);
    }
    const blocked = checkRateLimit(key, { max: 3, windowMs: WINDOW, now });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  test("attempts fall out of the window over time", () => {
    const key = "test:window";
    let clock = 1_000_000;
    const now = () => clock;
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit(key, { max: 3, windowMs: WINDOW, now }).allowed).toBe(true);
    }
    expect(checkRateLimit(key, { max: 3, windowMs: WINDOW, now }).allowed).toBe(false);
    clock += WINDOW + 1; // the whole window elapses
    expect(checkRateLimit(key, { max: 3, windowMs: WINDOW, now }).allowed).toBe(true);
  });

  test("remaining counts down", () => {
    const key = "test:remaining";
    const now = () => 1_000_000;
    expect(checkRateLimit(key, { max: 2, windowMs: WINDOW, now }).remaining).toBe(1);
    expect(checkRateLimit(key, { max: 2, windowMs: WINDOW, now }).remaining).toBe(0);
  });

  test("resetRateLimit clears strikes (successful login path)", () => {
    const key = "test:reset";
    const now = () => 1_000_000;
    for (let i = 0; i < 3; i++) checkRateLimit(key, { max: 3, windowMs: WINDOW, now });
    expect(checkRateLimit(key, { max: 3, windowMs: WINDOW, now }).allowed).toBe(false);
    resetRateLimit(key);
    expect(checkRateLimit(key, { max: 3, windowMs: WINDOW, now }).allowed).toBe(true);
  });

  test("keys are independent", () => {
    const now = () => 1_000_000;
    for (let i = 0; i < 3; i++) checkRateLimit("test:a", { max: 3, windowMs: WINDOW, now });
    expect(checkRateLimit("test:a", { max: 3, windowMs: WINDOW, now }).allowed).toBe(false);
    expect(checkRateLimit("test:b", { max: 3, windowMs: WINDOW, now }).allowed).toBe(true);
  });
});
