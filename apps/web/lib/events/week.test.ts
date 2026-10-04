import { describe, expect, test } from "bun:test";
import { istDateKey, istWeekKeys, istWeekRange, monthDayOf, recursOn, sortWeekEvents, type WeekEventItem } from "./week";

describe("istDateKey", () => {
  test("uses the IST calendar, not UTC", () => {
    // 20:00 UTC on the 4th is already 01:30 on the 5th in IST.
    expect(istDateKey(new Date("2026-10-04T20:00:00Z"))).toBe("2026-10-05");
    expect(istDateKey(new Date("2026-10-04T12:00:00Z"))).toBe("2026-10-04");
  });
});

describe("istWeekKeys", () => {
  test("is Monday to Sunday around a midweek day", () => {
    // 2026-10-07 is a Wednesday.
    expect(istWeekKeys(new Date("2026-10-07T06:00:00Z"))).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
    ]);
  });

  test("Sunday belongs to the week that started the previous Monday", () => {
    const keys = istWeekKeys(new Date("2026-10-11T06:00:00Z")); // Sunday
    expect(keys[0]).toBe("2026-10-05");
    expect(keys[6]).toBe("2026-10-11");
  });

  test("Sunday night UTC is already Monday in IST, so it starts the next week", () => {
    // Sun 2026-10-04 20:00 UTC = Mon 2026-10-05 01:30 IST.
    expect(istWeekKeys(new Date("2026-10-04T20:00:00Z"))[0]).toBe("2026-10-05");
  });

  test("crosses a month and a year boundary", () => {
    const keys = istWeekKeys(new Date("2026-12-31T06:00:00Z")); // Thursday
    expect(keys[0]).toBe("2026-12-28");
    expect(keys[6]).toBe("2027-01-03");
  });
});

describe("istWeekRange", () => {
  test("spans exactly seven IST days", () => {
    const { start, end } = istWeekRange("2026-10-05");
    expect(start.toISOString()).toBe("2026-10-04T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-10-11T18:30:00.000Z");
  });

  test("a 9am IST Monday meeting is inside; a 00:10 IST next-Monday one is not", () => {
    const { start, end } = istWeekRange("2026-10-05");
    const mondayNine = new Date("2026-10-05T03:30:00Z");
    const nextMondayEarly = new Date("2026-10-11T18:40:00Z");
    expect(mondayNine >= start && mondayNine < end).toBe(true);
    expect(nextMondayEarly >= start && nextMondayEarly < end).toBe(false);
  });
});

describe("recursOn / monthDayOf", () => {
  test("matches by month and day whatever the original year", () => {
    const dob = new Date("1994-10-08T00:00:00Z");
    expect(recursOn(monthDayOf(dob), "2026-10-08")).toBe(true);
    expect(recursOn(monthDayOf(dob), "2026-10-09")).toBe(false);
  });

  test("29 Feb is observed on 28 Feb in a non-leap year, and on 29 Feb in a leap year", () => {
    expect(recursOn("02-29", "2027-02-28")).toBe(true);
    expect(recursOn("02-29", "2027-03-01")).toBe(false);
    expect(recursOn("02-29", "2028-02-29")).toBe(true);
    expect(recursOn("02-29", "2028-02-28")).toBe(false);
  });
});

describe("sortWeekEvents", () => {
  const item = (over: Partial<WeekEventItem>): WeekEventItem => ({
    id: "x",
    kind: "custom",
    date: "2026-10-05",
    title: "t",
    ...over,
  });

  test("orders by date, then meetings by time, then kind", () => {
    const sorted = sortWeekEvents([
      item({ id: "late-meeting", kind: "meeting", date: "2026-10-06", at: "2026-10-06T10:00:00Z" }),
      item({ id: "birthday", kind: "birthday", date: "2026-10-06" }),
      item({ id: "early-meeting", kind: "meeting", date: "2026-10-06", at: "2026-10-06T04:00:00Z" }),
      item({ id: "monday", kind: "custom", date: "2026-10-05" }),
    ]);
    expect(sorted.map((s) => s.id)).toEqual(["monday", "early-meeting", "late-meeting", "birthday"]);
  });
});
