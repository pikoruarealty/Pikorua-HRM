import { describe, expect, test } from "bun:test";
import {
  hoursToPoints,
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
