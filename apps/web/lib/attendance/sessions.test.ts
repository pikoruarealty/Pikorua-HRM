import { describe, expect, test } from "bun:test";
import { sessionBounds, sumSessionHours, summariseSessions } from "./sessions";

const t = (h: number, m = 0) => new Date(Date.UTC(2026, 7, 11, h, m));

describe("sumSessionHours", () => {
  test("a single closed session is just its length", () => {
    expect(sumSessionHours([{ clockIn: t(9), clockOut: t(18) }])).toBe(9);
  });

  test("breaks between sessions are not worked time", () => {
    // In 09:00-13:00, out for two hours, back 15:00-18:00. Last-out minus
    // first-in would say 9 hours and pay the lunch break as work.
    const worked = sumSessionHours([
      { clockIn: t(9), clockOut: t(13) },
      { clockIn: t(15), clockOut: t(18) },
    ]);
    expect(worked).toBe(7);
  });

  test("an open session contributes nothing until it is closed", () => {
    expect(
      sumSessionHours([
        { clockIn: t(9), clockOut: t(13) },
        { clockIn: t(15), clockOut: null },
      ]),
    ).toBe(4);
  });

  test("no sessions is zero, not NaN", () => {
    expect(sumSessionHours([])).toBe(0);
  });

  test("an inverted session is clamped to zero rather than subtracting time", () => {
    expect(
      sumSessionHours([
        { clockIn: t(9), clockOut: t(13) },
        { clockIn: t(18), clockOut: t(15) },
      ]),
    ).toBe(4);
  });
});

describe("summariseSessions", () => {
  test("under the full-day threshold across all sessions is a half-day", () => {
    expect(
      summariseSessions([
        { clockIn: t(9), clockOut: t(11) },
        { clockIn: t(14), clockOut: t(16) },
      ]),
    ).toEqual({ totalHours: 4, isHalfDay: true });
  });

  test("the same span with no break is a full day", () => {
    expect(summariseSessions([{ clockIn: t(9), clockOut: t(18) }])).toEqual({
      totalHours: 9,
      isHalfDay: false,
    });
  });

  test("nothing worked is neither present nor half", () => {
    expect(summariseSessions([{ clockIn: t(9), clockOut: null }])).toEqual({
      totalHours: 0,
      isHalfDay: false,
    });
  });
});

describe("sessionBounds", () => {
  test("first in and last out across several sessions", () => {
    const { firstIn, lastOut } = sessionBounds([
      { clockIn: t(15), clockOut: t(18) },
      { clockIn: t(9), clockOut: t(13) },
    ]);
    // Late-arrival is measured from the day's FIRST punch in, so a post-lunch
    // return must never become the day's clock-in.
    expect(firstIn).toEqual(t(9));
    expect(lastOut).toEqual(t(18));
  });

  test("an open session means the day has no end yet", () => {
    const { firstIn, lastOut } = sessionBounds([
      { clockIn: t(9), clockOut: t(13) },
      { clockIn: t(15), clockOut: null },
    ]);
    expect(firstIn).toEqual(t(9));
    expect(lastOut).toBeNull();
  });

  test("no sessions has no bounds", () => {
    expect(sessionBounds([])).toEqual({ firstIn: null, lastOut: null });
  });
});
