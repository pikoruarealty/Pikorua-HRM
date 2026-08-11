import { describe, expect, test } from "bun:test";
import { SalesMetric } from "@prisma/client";
import { attainmentFor, summariseMetricItems, type MetricItem } from "./monthly-attainment";

const EMP = "emp-1";

function callRow(current: number, target: number): MetricItem {
  return {
    assignedTo: EMP,
    salesMetric: SalesMetric.calls,
    currentValue: current,
    targetValue: target,
  };
}

describe("summariseMetricItems", () => {
  test("sums each metric within its own kind rather than across kinds", () => {
    const totals = summariseMetricItems([
      callRow(80, 100),
      callRow(120, 100),
      {
        assignedTo: EMP,
        salesMetric: SalesMetric.site_visits,
        currentValue: 6,
        targetValue: 20,
      },
      { assignedTo: EMP, salesMetric: SalesMetric.bookings, currentValue: 1, targetValue: 2 },
    ]).get(EMP)!;

    expect(totals.calls).toEqual({ current: 200, target: 200 });
    expect(totals.siteVisits).toEqual({ current: 6, target: 20 });
    expect(totals.bookings).toEqual({ current: 1, target: 2 });
  });

  test("keeps employees apart", () => {
    const map = summariseMetricItems([
      callRow(50, 100),
      { assignedTo: "emp-2", salesMetric: SalesMetric.calls, currentValue: 90, targetValue: 100 },
    ]);
    expect(map.get(EMP)!.calls.current).toBe(50);
    expect(map.get("emp-2")!.calls.current).toBe(90);
  });

  test("a metric-mode item that is not a sales metric is ignored", () => {
    // Folding a hand-created target into one of the three buckets would
    // silently distort that bucket's attainment.
    const map = summariseMetricItems([
      { assignedTo: EMP, salesMetric: null, currentValue: 999, targetValue: 1 },
    ]);
    expect(map.has(EMP)).toBe(false);
  });

  test("null and Decimal-ish values do not become NaN", () => {
    const totals = summariseMetricItems([
      { assignedTo: EMP, salesMetric: SalesMetric.calls, currentValue: null, targetValue: "100" },
    ]).get(EMP)!;
    expect(totals.calls).toEqual({ current: 0, target: 100 });
  });
});

describe("attainmentFor", () => {
  const base = {
    calls: { current: 0, target: 0 },
    siteVisits: { current: 0, target: 0 },
    bookings: { current: 0, target: 0 },
  };

  test("calls are paced by construction — one row per expected selling day", () => {
    // 10 days provisioned at 100/day, 900 dialled: 90%, regardless of how many
    // days remain in the month.
    const a = attainmentFor({ ...base, calls: { current: 900, target: 1000 } }, 10, 22);
    expect(a.callsPct).toBe(90);
    expect(a.callsDetail).toBe("900 of 1000 calls");
  });

  test("monthly outcomes are pro-rated to the elapsed part of the month", () => {
    // Half the expected selling days gone, so the 20-visit target is worth 10.
    const a = attainmentFor({ ...base, siteVisits: { current: 10, target: 20 } }, 11, 22);
    expect(a.siteVisitsPct).toBe(100);
    expect(a.outcomeDetail).toBe("10 of 10 visits");
  });

  test("a rep on day 2 of the month is not scored as a failure", () => {
    const early = attainmentFor({ ...base, bookings: { current: 0, target: 2 } }, 2, 22);
    // 2/22 of a 2-booking target is 0.18 — zero bookings against it is a real
    // measured zero, but it is measured against a fair, tiny target.
    expect(early.bookingsPct).toBe(0);
    const paced = attainmentFor({ ...base, bookings: { current: 1, target: 2 } }, 2, 22);
    expect(paced.bookingsPct).toBeGreaterThan(100);
  });

  test("no target set is unmeasurable, not 0%", () => {
    const a = attainmentFor(base, 10, 22);
    expect(a.callsPct).toBeNull();
    expect(a.siteVisitsPct).toBeNull();
    expect(a.bookingsPct).toBeNull();
    expect(a.outcomePct).toBeNull();
    expect(a.callsDetail).toBeNull();
    expect(a.outcomeDetail).toBeNull();
  });

  test("nothing elapsed yet is unmeasurable rather than a zero", () => {
    const a = attainmentFor({ ...base, siteVisits: { current: 0, target: 20 } }, 0, 22);
    expect(a.siteVisitsPct).toBeNull();
  });

  test("bookings outweigh site visits in the blended outcome", () => {
    const visitsOnly = attainmentFor(
      { ...base, siteVisits: { current: 20, target: 20 }, bookings: { current: 0, target: 2 } },
      22,
      22,
    );
    const bookingsOnly = attainmentFor(
      { ...base, siteVisits: { current: 0, target: 20 }, bookings: { current: 2, target: 2 } },
      22,
      22,
    );
    // 17:23 — the same 100% is worth more when it is bookings.
    expect(visitsOnly.outcomePct).toBeCloseTo(42.5, 1);
    expect(bookingsOnly.outcomePct).toBeCloseTo(57.5, 1);
  });

  test("a metric with no target drops out of the blend instead of scoring 0", () => {
    const a = attainmentFor(
      { ...base, siteVisits: { current: 20, target: 20 }, bookings: { current: 0, target: 0 } },
      22,
      22,
    );
    expect(a.bookingsPct).toBeNull();
    expect(a.outcomePct).toBe(100);
  });

  test("dialling hard cannot rescue an outcome-free month", () => {
    // The whole point of splitting the buckets: 3x the call target used to
    // drown out one site-visit row in a flat average.
    const a = attainmentFor(
      {
        calls: { current: 3000, target: 1000 },
        siteVisits: { current: 0, target: 20 },
        bookings: { current: 0, target: 2 },
      },
      22,
      22,
    );
    expect(a.callsPct).toBe(300);
    expect(a.outcomePct).toBe(0);
  });
});
