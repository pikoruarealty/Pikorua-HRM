import { describe, expect, test } from "bun:test";
import { weeklySalesScore } from "./weekly-attainment";

const targets = { dailyCallTarget: 100, monthlySiteVisitTarget: 20, monthlyBookingTarget: 2 };

// A normal week: 5 selling days, in a month with 26.
const base = { targets, expectedDaysInWeek: 5, expectedDaysInMonth: 26 };

describe("weeklySalesScore", () => {
  test("hitting every paced target scores 100", () => {
    // Paced: 500 calls, 20*5/26 = 3.85 visits, 2*5/26 = 0.38 bookings.
    const r = weeklySalesScore({ ...base, calls: 500, siteVisits: 4, bookings: 1 });
    expect(r.callsPct).toBe(100);
    expect(r.siteVisitsPct).toBe(100);
    expect(r.bookingsPct).toBe(100);
    expect(r.score).toBe(100);
  });

  test("a rep who made calls scores above zero even with no visits or bookings", () => {
    const r = weeklySalesScore({ ...base, calls: 250, siteVisits: 0, bookings: 0 });
    expect(r.callsPct).toBe(50);
    // 50% * 10 / (10+17+23) = 10
    expect(r.score).toBe(10);
  });

  test("overshooting calls is capped and cannot buy back a missed booking", () => {
    const dialler = weeklySalesScore({ ...base, calls: 5000, siteVisits: 0, bookings: 0 });
    const closer = weeklySalesScore({ ...base, calls: 0, siteVisits: 0, bookings: 1 });
    expect(dialler.callsPct).toBe(100);
    expect(dialler.score).toBe(20);
    // bookings carry 23 of 50 — more than calls' 10.
    expect(closer.score).toBe(46);
    expect(closer.score!).toBeGreaterThan(dialler.score!);
  });

  test("no activity scores a measured 0, not null", () => {
    const r = weeklySalesScore({ ...base, calls: 0, siteVisits: 0, bookings: 0 });
    expect(r.score).toBe(0);
  });

  test("a metric with no target drops out and the weights renormalise", () => {
    const r = weeklySalesScore({
      ...base,
      targets: { dailyCallTarget: 100, monthlySiteVisitTarget: 0, monthlyBookingTarget: 0 },
      calls: 250,
      siteVisits: 9,
      bookings: 9,
    });
    expect(r.siteVisitsPct).toBeNull();
    expect(r.bookingsPct).toBeNull();
    expect(r.score).toBe(50);
  });

  test("a week with no expected selling days is unmeasurable (null), not failed", () => {
    const r = weeklySalesScore({ ...base, expectedDaysInWeek: 0, calls: 0, siteVisits: 0, bookings: 0 });
    expect(r.score).toBeNull();
  });
});
