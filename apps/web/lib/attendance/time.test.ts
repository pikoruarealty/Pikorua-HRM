import { describe, expect, test } from "bun:test";
import { computeHours, isLateArrival, isValidHHMM } from "./time";

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
});

describe("computeHours", () => {
  const t = (h: number, m = 0) => new Date(Date.UTC(2026, 6, 15, h, m));

  test("full day is not a half-day", () => {
    expect(computeHours(t(9), t(18))).toEqual({ totalHours: 9, isHalfDay: false });
  });

  test("under 5 hours is a half-day (PRD §5.1)", () => {
    expect(computeHours(t(9), t(13, 30))).toEqual({ totalHours: 4.5, isHalfDay: true });
  });

  test("exactly 5 hours is NOT a half-day", () => {
    expect(computeHours(t(9), t(14))).toEqual({ totalHours: 5, isHalfDay: false });
  });

  test("clock-out before clock-in clamps to 0 instead of going negative", () => {
    expect(computeHours(t(18), t(9))).toEqual({ totalHours: 0, isHalfDay: true });
  });

  test("rounds to 2 decimals", () => {
    const { totalHours } = computeHours(t(9), new Date(Date.UTC(2026, 6, 15, 17, 20)));
    expect(totalHours).toBe(8.33);
  });
});
