import { describe, expect, test } from "bun:test";
import {
  dailyCapHours,
  fitToDailyCap,
  hoursClaimed,
  hoursToPoints,
  MAX_ENTRY_HOURS,
  pointsToHours,
} from "./self-log-scoring";
import { buildSelfLogEffortPrompt, parseSelfLogEffort, GroqError } from "@/lib/ai/task-generation";

describe("hoursToPoints", () => {
  test("follows the ladder and is monotone", () => {
    expect([0.25, 0.5, 1, 2, 3, 4, 6, 8].map(hoursToPoints)).toEqual([1, 1, 2, 3, 4, 5, 6, 8]);
    let prev = 0;
    for (let h = 0.25; h <= 8; h += 0.25) {
      const p = hoursToPoints(h);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });

  test("a 4-hour job and an 8-hour job no longer score alike", () => {
    expect(hoursToPoints(4)).toBeLessThan(hoursToPoints(8));
  });

  test("one entry can never exceed a working day's points", () => {
    expect(hoursToPoints(40)).toBe(8);
    expect(hoursToPoints(Number.NaN)).toBe(1);
  });
});

describe("pointsToHours", () => {
  test("is the top of each band, so it round-trips conservatively", () => {
    for (const h of [0.5, 1, 2, 3, 4, 6, 8]) expect(pointsToHours(hoursToPoints(h))).toBe(h);
    expect(pointsToHours(hoursToPoints(5))).toBeGreaterThanOrEqual(5);
  });
});

describe("daily cap", () => {
  test("is the shift plus a quarter, defaulting to an 8h shift", () => {
    expect(dailyCapHours(8)).toBe(10);
    expect(dailyCapHours(0)).toBe(10);
    expect(dailyCapHours(6)).toBe(7.5);
  });

  test("the production day — 25 entries, ~5 points each — cannot fit", () => {
    const cap = dailyCapHours(8);
    let used = 0;
    let accepted = 0;
    let points = 0;
    for (let i = 0; i < 25; i++) {
      const fit = fitToDailyCap(2, cap - used); // a typical "3-point" entry
      if (!fit.allowed) continue;
      accepted++;
      points += fit.points;
      used += pointsToHours(fit.points);
    }
    expect(accepted).toBeLessThan(6);
    expect(points).toBeLessThan(20); // was 149
  });

  test("an estimate bigger than what's left is clamped, not refused", () => {
    const fit = fitToDailyCap(8, 3);
    expect(fit.allowed).toBe(true);
    if (fit.allowed) {
      expect(pointsToHours(fit.points)).toBeLessThanOrEqual(3);
      expect(fit.clamped).toBe(true);
    }
  });

  test("once less than the smallest entry is left, it's refused", () => {
    expect(fitToDailyCap(1, 0.25).allowed).toBe(false);
    expect(fitToDailyCap(1, 0).allowed).toBe(false);
  });

  test("a single entry is limited to one working day", () => {
    const fit = fitToDailyCap(30, 10);
    expect(fit.allowed && fit.hours).toBe(MAX_ENTRY_HOURS);
  });

  test("hoursClaimed adds up the day's points", () => {
    expect(hoursClaimed([1, 2, 5])).toBe(0.5 + 1 + 4);
  });
});

describe("effort prompt + parsing", () => {
  test("the prompt tells the model wording is not effort and shows the day's earlier entries", () => {
    const { system, user } = buildSelfLogEffortPrompt(
      { title: "Added site-visit migration", description: "Persist parent-visit relationships." },
      { earlierToday: [{ title: "Updated site-visit APIs and schema", points: 5 }] },
    );
    expect(system).toMatch(/not the writing|NOT separate work/i);
    expect(system).toMatch(/8 hours/);
    expect(user).toContain("Updated site-visit APIs and schema");
    expect(user).toContain("Added site-visit migration");
  });

  test("with nothing logged yet the context says so", () => {
    const { user } = buildSelfLogEffortPrompt({ title: "t", description: "d" }, { earlierToday: [] });
    expect(user).toContain("none");
  });

  test("parses hours, clamps to 0.25..8, and tolerates missing optional fields", () => {
    expect(parseSelfLogEffort('{"hours": 3}')).toEqual({ hours: 3, overlap: false, reason: "" });
    expect(parseSelfLogEffort('{"hours": 99, "overlap": true, "reason": "big"}')).toMatchObject({
      hours: 8,
      overlap: true,
    });
    expect(parseSelfLogEffort('{"hours": 0.01}').hours).toBe(0.25);
  });

  test("rejects a reply that isn't a usable estimate", () => {
    expect(() => parseSelfLogEffort("not json")).toThrow(GroqError);
    expect(() => parseSelfLogEffort('{"hours": "a lot"}')).toThrow(GroqError);
    expect(() => parseSelfLogEffort('{"hours": -2}')).toThrow(GroqError);
  });
});
