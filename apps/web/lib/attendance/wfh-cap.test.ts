import { describe, expect, test } from "bun:test";
import {
  computeWfhBalance,
  countedWfhHours,
  DEFAULT_WFH_WEEKLY_CAP_HOURS,
  wfhCapForWeek,
  type WfhWeekInput,
} from "./wfh-hours";

// 2026-10-24: the WFH weekly cap (hours beyond it don't count unless an Admin
// approves them) and "office covers WFH" in the advance/late balance.

const mon = (n: number) => new Date(Date.UTC(2026, 6, 6 + n * 7)); // 6 July 2026 + n weeks
const week = (n: number, worked: number, complete = true, officeExtra = 0): WfhWeekInput => ({
  weekStart: mon(n),
  worked,
  complete,
  officeExtra,
});
const NOW = new Date("2026-08-20T00:00:00.000Z");
const TARGET = 6;

describe("countedWfhHours (weekly cap)", () => {
  test("hours up to the cap all count", () => {
    expect(countedWfhHours(6, 10)).toBe(6);
    expect(countedWfhHours(10, 10)).toBe(10);
  });

  test("15 worked with a 10 cap counts 10", () => {
    expect(countedWfhHours(15, 10)).toBe(10);
  });

  test("an Admin-approved extra raises the limit, but never past what was worked", () => {
    expect(countedWfhHours(15, 10, 3)).toBe(13);
    expect(countedWfhHours(15, 10, 5)).toBe(15);
    expect(countedWfhHours(12, 10, 5)).toBe(12);
  });

  test("a negative approval or zero hours cannot go below zero", () => {
    expect(countedWfhHours(15, 10, -4)).toBe(10);
    expect(countedWfhHours(0, 10, 3)).toBe(0);
  });

  test("rounds to 2 decimals", () => {
    expect(countedWfhHours(10.126, 20)).toBe(10.13);
  });

  test("the default cap is 10 hours", () => {
    expect(DEFAULT_WFH_WEEKLY_CAP_HOURS).toBe(10);
  });
});

describe("wfhCapForWeek (versioned cap)", () => {
  const history = [
    { effectiveFrom: new Date("2026-07-01T00:00:00.000Z"), capHours: 12 },
    { effectiveFrom: new Date("2026-08-03T00:00:00.000Z"), capHours: 8 },
  ];

  test("falls back to the default before any config row", () => {
    expect(wfhCapForWeek(history, new Date("2026-06-22T00:00:00.000Z"))).toBe(10);
    expect(wfhCapForWeek([], mon(0))).toBe(10);
  });

  test("a week uses the latest row effective on or before its Monday", () => {
    expect(wfhCapForWeek(history, new Date("2026-07-27T00:00:00.000Z"))).toBe(12);
    expect(wfhCapForWeek(history, new Date("2026-08-03T00:00:00.000Z"))).toBe(8);
    expect(wfhCapForWeek(history, new Date("2026-09-14T00:00:00.000Z"))).toBe(8);
  });

  test("history given in any order resolves the same", () => {
    const reversed = [...history].reverse();
    expect(wfhCapForWeek(reversed, new Date("2026-09-14T00:00:00.000Z"))).toBe(8);
    expect(wfhCapForWeek(reversed, new Date("2026-07-27T00:00:00.000Z"))).toBe(12);
  });
});

describe("computeWfhBalance — capped hours bank only what counts", () => {
  test("15h worked against a 6h target banks 4h (10 counted - 6), not 9", () => {
    const b = computeWfhBalance([week(0, countedWfhHours(15, 10))], TARGET, NOW);
    expect(b.bankedHours).toBe(4);
  });

  test("an Admin-approved extra banks the extra too", () => {
    const b = computeWfhBalance([week(0, countedWfhHours(15, 10, 3))], TARGET, NOW);
    expect(b.bankedHours).toBe(7);
  });
});

describe("computeWfhBalance — office time covers WFH, never the other way round", () => {
  test("office hours over the in-office quota cover a WFH shortfall in the same week", () => {
    // 2h WFH of a 6h target = 4h short; 3h of office extra covers 3h of it.
    const b = computeWfhBalance([week(0, 2, true, 3)], TARGET, NOW);
    expect(b.owedHours).toBe(1);
    expect(b.bankedHours).toBe(0);
  });

  test("office extra beyond the shortfall banks for a later WFH shortfall", () => {
    // Week 0: WFH on target, 5h office extra banks. Week 1: 4h WFH short, covered from the bank.
    const b = computeWfhBalance([week(0, 6, true, 5), week(1, 2)], TARGET, NOW);
    expect(b.owedHours).toBe(0);
    expect(b.bankedHours).toBe(1);
    expect(b.bankedFromOfficeHours).toBe(1);
  });

  test("office extra makes up an older WFH shortfall first", () => {
    // wk0 owes 4; wk1's 2h office extra covers 2 of it.
    const b = computeWfhBalance([week(0, 2), week(1, 6, true, 2)], TARGET, NOW);
    expect(b.owedHours).toBe(2);
  });

  test("a banked WFH surplus is spent first, then leftover office extra banks", () => {
    // +4 banked; wk1 short 4: bank covers it all, the 1h office extra then banks.
    const b = computeWfhBalance([week(0, 10), week(1, 2, true, 1)], TARGET, NOW);
    expect(b.owedHours).toBe(0);
    expect(b.bankedHours).toBe(1);
    expect(b.bankedFromOfficeHours).toBe(1);
  });

  test("office extra lapses after 60 days like any banked surplus", () => {
    const b = computeWfhBalance([week(0, 6, true, 5)], TARGET, new Date("2026-09-15T00:00:00.000Z"));
    expect(b.bankedHours).toBe(0);
  });

  test("a week still in progress does not bank office extra", () => {
    const b = computeWfhBalance([week(0, 6, false, 5)], TARGET, NOW);
    expect(b.bankedHours).toBe(0);
  });

  test("no office extra changes nothing (back-compat)", () => {
    const withField = computeWfhBalance([week(0, 10, true, 0), week(1, 4, true, 0)], TARGET, NOW);
    const without = computeWfhBalance(
      [
        { weekStart: mon(0), worked: 10, complete: true },
        { weekStart: mon(1), worked: 4, complete: true },
      ],
      TARGET,
      NOW,
    );
    expect(withField).toEqual(without);
  });
});
