import { describe, expect, test } from "bun:test";
import { summariseWfhMonth } from "./wfh-hours";

// 2026-11-01: the WFH-hours section — per Mon-Sun week (target and cap are weekly) and
// for the month. Every hour stays in the month it was worked in; a week split across
// two months gives each its share of the target (by days) and of the counted hours
// (in proportion to the hours worked there).
const base = {
  month: 10,
  year: 2026,
  targetPerWeek: 6,
  measuredFrom: "2026-06-01",
  capFor: () => 10,
  extraFor: () => 0,
  todayKey: "2026-11-01",
};

describe("summariseWfhMonth", () => {
  test("a week over the cap counts 10h; a short week says by how much", () => {
    const wfhByDay = new Map([
      ["2026-10-07", 8], ["2026-10-08", 7.6], // week of 5 Oct: 15.6h
      ["2026-10-13", 2], ["2026-10-14", 2], // week of 12 Oct: 4h
    ]);
    const m = summariseWfhMonth({ ...base, wfhByDay });
    const w5 = m.weeks.find((w) => w.weekStart === "2026-10-05")!;
    const w12 = m.weeks.find((w) => w.weekStart === "2026-10-12")!;
    expect(w5).toMatchObject({ actualWeek: 15.6, countedWeek: 10, status: "met", short: 0 });
    expect(w12).toMatchObject({ actualWeek: 4, countedWeek: 4, status: "short", short: 2 });
    expect(m.worked).toBe(19.6);
    expect(m.counted).toBe(14);
    // Month target: 6h a week over October's 31 days.
    expect(m.target).toBeCloseTo((6 * 31) / 7, 1);
  });

  test("a split week shares its target by days and its counted hours by where they were worked", () => {
    // Week of 28 Sep: 3 days in Sep, 4 in Oct. 12h worked: 4h in Sep, 8h in Oct; 10h counts.
    const wfhByDay = new Map([["2026-09-29", 4], ["2026-10-02", 8]]);
    const m = summariseWfhMonth({ ...base, wfhByDay });
    const w = m.weeks[0]!;
    expect(w.weekStart).toBe("2026-09-28");
    expect(w).toMatchObject({ actualWeek: 12, actualInMonth: 8, countedWeek: 10, targetInMonth: 3.43 });
    expect(w.countedInMonth).toBeCloseTo(6.67, 2);
  });

  test("before the target applied, a week owes nothing", () => {
    const m = summariseWfhMonth({ ...base, measuredFrom: "2026-10-19", wfhByDay: new Map() });
    expect(m.weeks.filter((w) => w.target === 0).map((w) => w.weekStart)).toEqual(["2026-09-28", "2026-10-05", "2026-10-12"]);
    expect(m.weeks.find((w) => w.weekStart === "2026-10-19")).toMatchObject({ status: "short", short: 6 });
  });
});
