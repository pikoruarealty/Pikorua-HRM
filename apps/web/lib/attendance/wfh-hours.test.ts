import { describe, expect, test } from "bun:test";
import { computeWfhBalance, type WfhWeekInput } from "./wfh-hours";

// Mondays, a week apart.
const mon = (n: number) => new Date(Date.UTC(2026, 6, 6 + n * 7)); // 6 July 2026 + n weeks
const week = (n: number, worked: number, complete = true): WfhWeekInput => ({
  weekStart: mon(n),
  worked,
  complete,
});
const NOW = new Date("2026-08-20T00:00:00.000Z");
const TARGET = 6;

describe("computeWfhBalance", () => {
  test("meeting the target every week leaves nothing banked or owed", () => {
    const b = computeWfhBalance([week(0, 6), week(1, 6), week(2, 6)], TARGET, NOW);
    expect(b).toMatchObject({ bankedHours: 0, owedHours: 0, unmetHours: 0 });
  });

  test("working ahead banks the surplus, and a later short week spends it (advance)", () => {
    const b = computeWfhBalance([week(0, 10), week(1, 4)], TARGET, NOW);
    // +4 banked, then -2 short: 2 left banked, nothing owed.
    expect(b.bankedHours).toBe(2);
    expect(b.owedHours).toBe(0);
  });

  test("a short week stays owed until a later surplus makes it up (late)", () => {
    const after1 = computeWfhBalance([week(0, 2)], TARGET, NOW);
    expect(after1.owedHours).toBe(4);
    const after2 = computeWfhBalance([week(0, 2), week(1, 9)], TARGET, NOW);
    // +3 surplus makes up 3 of the 4 owed.
    expect(after2.owedHours).toBe(1);
    expect(after2.bankedHours).toBe(0);
  });

  test("the oldest shortfall is made up first", () => {
    const b = computeWfhBalance([week(0, 4), week(1, 4), week(2, 7)], TARGET, NOW);
    // owed 2 (wk0) + 2 (wk1); +1 goes to wk0 -> owed 1 + 2 = 3.
    expect(b.owedHours).toBe(3);
  });

  test("a shortfall nothing covers inside 60 days becomes unmet", () => {
    // Week 0 (ends 13 Jul) short by 6; window closes 11 Sep, but NOW is later.
    const b = computeWfhBalance([week(0, 0)], TARGET, new Date("2026-09-15T00:00:00.000Z"));
    expect(b.owedHours).toBe(0);
    expect(b.unmetHours).toBe(6);
  });

  test("a surplus older than 60 days can no longer cover a shortfall", () => {
    // +6 banked at the end of week 0 (13 Jul) expires ~11 Sep; week 11 ends later.
    const b = computeWfhBalance([week(0, 12), week(11, 0)], TARGET, new Date("2026-10-30T00:00:00.000Z"));
    // Week 0's surplus lapsed before week 11 ended, so it can't cover week 11's
    // shortfall — which therefore stays owed (its own window is still open).
    expect(b.bankedHours).toBe(0);
    expect(b.owedHours).toBe(6);
    expect(b.unmetHours).toBe(0);
  });

  test("a week still in progress neither banks nor owes", () => {
    const b = computeWfhBalance([week(0, 6), week(1, 1, false)], TARGET, NOW);
    expect(b).toMatchObject({ bankedHours: 0, owedHours: 0, unmetHours: 0 });
  });

  test("reports when the open amounts lapse", () => {
    const owed = computeWfhBalance([week(0, 2)], TARGET, NOW);
    // Week 0 ends Mon 13 Jul; +60 days = 11 Sep.
    expect(owed.owedUntil).toBe("2026-09-11");
    const banked = computeWfhBalance([week(0, 9)], TARGET, NOW);
    expect(banked.bankedUntil).toBe("2026-09-11");
  });
});
