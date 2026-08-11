import { describe, expect, test } from "bun:test";
import { computeHours, dayCredit, getDefaultClockOut, isLateArrival, isValidHHMM, todayDateOnly } from "./time";

describe("isValidHHMM", () => {
  test("accepts 24h HH:MM", () => {
    expect(isValidHHMM("09:00")).toBe(true);
    expect(isValidHHMM("23:59")).toBe(true);
    expect(isValidHHMM("00:00")).toBe(true);
  });

  test("rejects out-of-range and malformed values", () => {
    expect(isValidHHMM("24:00")).toBe(false);
    expect(isValidHHMM("9:00")).toBe(false);
    expect(isValidHHMM("09:60")).toBe(false);
    expect(isValidHHMM("0900")).toBe(false);
  });
});

describe("isLateArrival", () => {
  // isLateArrival compares in server-local time — build local-time dates.
  const at = (h: number, m: number) => new Date(2026, 6, 15, h, m);

  test("after expected start is late", () => {
    expect(isLateArrival(at(9, 1), "09:00")).toBe(true);
  });

  test("exactly on time or earlier is not late", () => {
    expect(isLateArrival(at(9, 0), "09:00")).toBe(false);
    expect(isLateArrival(at(8, 59), "09:00")).toBe(false);
  });

  test("no configured start time means never late (explicit unavailable-note path)", () => {
    expect(isLateArrival(at(23, 59), null)).toBe(false);
  });

  test("grace window: within grace is not late, past it is", () => {
    expect(isLateArrival(at(9, 15), "09:00", 15)).toBe(false);
    expect(isLateArrival(at(9, 16), "09:00", 15)).toBe(true);
    // grace defaults to 0 → exact-to-the-minute
    expect(isLateArrival(at(9, 1), "09:00")).toBe(true);
  });
});

describe("computeHours", () => {
  const t = (h: number, m = 0) => new Date(Date.UTC(2026, 6, 15, h, m));

  test("full day is not a half-day", () => {
    expect(computeHours(t(9), t(18))).toEqual({ totalHours: 9, isHalfDay: false });
  });

  test("anything under 5 hours is a half-day", () => {
    expect(computeHours(t(9), t(13, 30))).toEqual({ totalHours: 4.5, isHalfDay: true });
    expect(computeHours(t(9), t(11))).toEqual({ totalHours: 2, isHalfDay: true });
  });

  test("exactly 5 hours is NOT a half-day", () => {
    expect(computeHours(t(9), t(14))).toEqual({ totalHours: 5, isHalfDay: false });
  });

  test("a very short day is a half-day, never a full one", () => {
    // The old 1.5h floor made these isHalfDay=false, which classifyMonth then
    // read as a FULL present day — five minutes of attendance, a whole day's pay.
    expect(computeHours(t(9), t(10, 30))).toEqual({ totalHours: 1.5, isHalfDay: true });
    expect(computeHours(t(9), t(10))).toEqual({ totalHours: 1, isHalfDay: true });
    expect(computeHours(t(9), t(9, 5))).toEqual({ totalHours: 0.08, isHalfDay: true });
  });

  test("clock-out before clock-in clamps to 0 (not a half-day)", () => {
    expect(computeHours(t(18), t(9))).toEqual({ totalHours: 0, isHalfDay: false });
  });

  test("rounds to 2 decimals", () => {
    const { totalHours } = computeHours(t(9), new Date(Date.UTC(2026, 6, 15, 17, 20)));
    expect(totalHours).toBe(8.33);
  });
});

describe("dayCredit", () => {
  test("an open day (no clock-out yet) counts as present", () => {
    expect(dayCredit(null, false)).toBe(1);
    expect(dayCredit(undefined, false)).toBe(1);
  });

  test("a full day is worth 1, a half-day 0.5", () => {
    expect(dayCredit(9, false)).toBe(1);
    expect(dayCredit(3, true)).toBe(0.5);
  });

  test("zero or inverted hours are worth nothing, not a full day", () => {
    expect(dayCredit(0, false)).toBe(0);
    expect(dayCredit(-2, false)).toBe(0);
    // even if some caller had wrongly flagged it a half-day
    expect(dayCredit(0, true)).toBe(0);
  });
});

describe("todayDateOnly", () => {
  test("uses the server's LOCAL calendar day, at UTC midnight", () => {
    const d = todayDateOnly();
    const now = new Date();
    expect(d.getUTCFullYear()).toBe(now.getFullYear());
    expect(d.getUTCMonth()).toBe(now.getMonth());
    // The old toISOString().slice(0,10) form returned the UTC day, which is
    // yesterday for the whole 00:00-05:30 window in IST.
    expect(d.getUTCDate()).toBe(now.getDate());
    expect(d.getUTCHours()).toBe(0);
  });
});

describe("getDefaultClockOut", () => {
  test("defaults to 20:00 when expected start is 11:00", () => {
    const date = new Date(2026, 6, 15, 11, 0);
    const out = getDefaultClockOut(date, "11:00");
    expect(out.getHours()).toBe(20);
    expect(out.getMinutes()).toBe(0);
    expect(out.getDate()).toBe(15);
  });

  test("uses expected start time + 9h when configured differently (e.g. 09:00 -> 18:00)", () => {
    const date = new Date(2026, 6, 15, 9, 15);
    const out = getDefaultClockOut(date, "09:00");
    expect(out.getHours()).toBe(18);
    expect(out.getMinutes()).toBe(0);
  });

  test("handles clockIn after standard end time by adding 8 hours", () => {
    const lateNightIn = new Date(2026, 6, 15, 21, 30);
    const out = getDefaultClockOut(lateNightIn, "11:00");
    expect(out.getTime()).toBeGreaterThan(lateNightIn.getTime());
    expect(out.getTime() - lateNightIn.getTime()).toBe(8 * 3600 * 1000);
  });
});

