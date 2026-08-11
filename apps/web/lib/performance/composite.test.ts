import { describe, expect, test } from "bun:test";
import { SALES_METRIC_WEIGHTS } from "@/lib/sales/pacing";
import {
  COMPONENT_DESCRIPTIONS,
  COMPONENT_LABELS,
  COMPONENT_WEIGHTS,
  SALES_PROFILE,
  SALES_WEIGHTS,
  TECH_PROFILE,
  TECH_WEIGHTS,
  attendanceToScore,
  clampScore,
  computeComposite,
  profileFor,
  ratingToScore,
  ratioToScore,
  relativeToBest,
  type ComponentKey,
} from "./composite";

describe("weight table", () => {
  test("every key has a label and a description in every profile", () => {
    for (const profile of [TECH_PROFILE, SALES_PROFILE]) {
      for (const key of Object.keys(COMPONENT_WEIGHTS) as ComponentKey[]) {
        expect(profile.labels[key]).toBeTruthy();
        expect(profile.descriptions[key]).toBeTruthy();
      }
    }
    for (const key of Object.keys(COMPONENT_WEIGHTS) as ComponentKey[]) {
      expect(COMPONENT_LABELS[key]).toBeTruthy();
      expect(COMPONENT_DESCRIPTIONS[key]).toBeTruthy();
    }
  });

  test("Tech has no CRM outcomes and Sales has no due-date timeliness", () => {
    expect(TECH_WEIGHTS.salesOutcome).toBe(0);
    expect(SALES_WEIGHTS.timeliness).toBe(0);
  });

  test("output is half the score in both departments", () => {
    expect(TECH_WEIGHTS.output).toBe(50);
    // Sales splits the same 50 across calls (output) and the two outcomes.
    expect(SALES_WEIGHTS.output + SALES_WEIGHTS.salesOutcome).toBe(50);
  });

  test("the sales output block honours the locked 3:5:7 ratio", () => {
    // calls 10 : site visits 17 : bookings 23, the last two blended into
    // salesOutcome by lib/sales/pacing.ts.
    expect(SALES_WEIGHTS.output).toBe(SALES_METRIC_WEIGHTS.calls);
    expect(SALES_WEIGHTS.salesOutcome).toBe(
      SALES_METRIC_WEIGHTS.siteVisits + SALES_METRIC_WEIGHTS.bookings,
    );
  });

  test("active weights sum to 100 in every profile", () => {
    for (const weights of [TECH_WEIGHTS, SALES_WEIGHTS]) {
      expect(Object.values(weights).reduce((a, b) => a + b, 0)).toBe(100);
    }
  });

  test("COMPONENT_WEIGHTS still points at the Tech table", () => {
    expect(COMPONENT_WEIGHTS).toEqual(TECH_WEIGHTS);
  });
});

describe("scoring profiles", () => {
  test("profileFor picks Sales for a metric department", () => {
    expect(profileFor(true)).toBe(SALES_PROFILE);
    expect(profileFor(false)).toBe(TECH_PROFILE);
  });

  test("the same inputs score differently under each profile", () => {
    const inputs = { output: { value: 100 }, attendance: { value: 0 } };
    // Tech: (100*50) / 67 = 74.63. Sales: (100*10) / 30 = 33.33 — dialling
    // alone can no longer carry a sales rep's score.
    expect(computeComposite(inputs, TECH_PROFILE).score).toBe(74.63);
    expect(computeComposite(inputs, SALES_PROFILE).score).toBe(33.33);
  });

  test("a sales rep's bookings outweigh their calls", () => {
    const dialler = computeComposite(
      { output: { value: 100 }, salesOutcome: { value: 0 } },
      SALES_PROFILE,
    );
    const closer = computeComposite(
      { output: { value: 0 }, salesOutcome: { value: 100 } },
      SALES_PROFILE,
    );
    expect(closer.score).toBeGreaterThan(dialler.score);
    expect(dialler.score).toBe(20); // 10 of 50
    expect(closer.score).toBe(80); // 40 of 50
  });

  test("the breakdown carries the profile's own wording", () => {
    const sales = computeComposite({ output: { value: 50 } }, SALES_PROFILE);
    expect(sales.components[0]!.label).toBe("Calls");
    expect(sales.components[0]!.description).toContain("daily target");

    const tech = computeComposite({ output: { value: 50 } }, TECH_PROFILE);
    expect(tech.components[0]!.label).toBe("Output");
    expect(tech.components[0]!.description).toContain("task points");
  });

  test("zero-weight slots are reported as inert, not as unmeasurable", () => {
    const tech = computeComposite({ output: { value: 50 } }, TECH_PROFILE);
    expect(tech.inert).toEqual(["salesOutcome"]);
    // Quality etc. were genuinely missing, so they are unavailable but NOT inert.
    expect(tech.unavailable).toContain("quality");
    expect(tech.inert).not.toContain("quality");

    const sales = computeComposite({ output: { value: 50 } }, SALES_PROFILE);
    expect(sales.inert).toEqual(["timeliness"]);
  });

  test("defaults to Tech so pre-existing callers are unchanged", () => {
    expect(computeComposite({ output: { value: 80 } })).toEqual(
      computeComposite({ output: { value: 80 } }, TECH_PROFILE),
    );
  });
});

describe("computeComposite", () => {
  test("blends components by weight when all are present", () => {
    const r = computeComposite({
      output: { value: 100 },
      quality: { value: 100 },
      attendance: { value: 100 },
      timeliness: { value: 100 },
      adherence: { value: 100 },
    });
    expect(r.score).toBe(100);
    expect(r.components).toHaveLength(5);
  });

  test("a perfect-output, zero-everything-else employee scores the output weight", () => {
    const r = computeComposite({
      output: { value: 100 },
      quality: { value: 0 },
      attendance: { value: 0 },
      timeliness: { value: 0 },
      adherence: { value: 0 },
    });
    expect(r.score).toBe(50);
  });

  test("missing components are dropped and remaining weights renormalise", () => {
    // Only output (50) and attendance (17) available -> 50:17 split of 67.
    const r = computeComposite({
      output: { value: 100 },
      attendance: { value: 40 },
    });
    // (100*50 + 40*17) / 67 = 84.78
    expect(r.score).toBe(84.78);
    expect(r.components.map((c) => c.key)).toEqual(["output", "attendance"]);
    expect(r.components[0]!.weight).toBeCloseTo(74.6, 1);
    expect(r.components[1]!.weight).toBeCloseTo(25.4, 1);
  });

  test("renormalised weights always total 100", () => {
    const r = computeComposite({ output: { value: 50 }, timeliness: { value: 50 } });
    const total = r.components.reduce((a, c) => a + c.weight, 0);
    expect(total).toBeCloseTo(100, 1);
  });

  test("a null value is unavailable, not zero", () => {
    const withNull = computeComposite({ output: { value: 80 }, quality: { value: null } });
    const withZero = computeComposite({ output: { value: 80 }, quality: { value: 0 } });
    expect(withNull.score).toBe(80);
    expect(withZero.score).toBeLessThan(80);
    expect(withNull.unavailable).toContain("quality");
  });

  test("first-month employee with no review is not punished for it", () => {
    const veteran = computeComposite({
      output: { value: 90 },
      attendance: { value: 90 },
      quality: { value: 90 },
    });
    const newcomer = computeComposite({
      output: { value: 90 },
      attendance: { value: 90 },
    });
    expect(newcomer.score).toBe(veteran.score);
  });

  test("zero-weight components never enter the score", () => {
    const r = computeComposite({ output: { value: 50 }, salesOutcome: { value: 100 } });
    expect(r.score).toBe(50);
    expect(r.unavailable).toContain("salesOutcome");
  });

  test("no measurable components scores 0 with an empty breakdown", () => {
    const r = computeComposite({});
    expect(r.score).toBe(0);
    expect(r.components).toEqual([]);
    expect(r.unavailable.length).toBe(Object.keys(COMPONENT_WEIGHTS).length);
  });

  test("out-of-range values are clamped rather than skewing the score", () => {
    const r = computeComposite({ output: { value: 250 }, attendance: { value: -30 } });
    // (100*50 + 0*17) / 67
    expect(r.score).toBe(74.63);
    expect(r.components[0]!.value).toBe(100);
    expect(r.components[1]!.value).toBe(0);
  });

  test("non-finite values are treated as unavailable", () => {
    const r = computeComposite({ output: { value: NaN }, attendance: { value: 60 } });
    expect(r.score).toBe(60);
    expect(r.unavailable).toContain("output");
  });

  test("detail strings survive onto the breakdown", () => {
    const r = computeComposite({ output: { value: 50, detail: "60 of 120 pts" } });
    expect(r.components[0]!.detail).toBe("60 of 120 pts");
    expect(r.components[0]!.nominalWeight).toBe(50);
  });

  test("components come back in a stable display order", () => {
    const r = computeComposite({
      adherence: { value: 10 },
      output: { value: 10 },
      attendance: { value: 10 },
    });
    expect(r.components.map((c) => c.key)).toEqual(["output", "attendance", "adherence"]);
  });
});

describe("relativeToBest", () => {
  test("the top scorer defines 100", () => {
    expect(relativeToBest(200, 200)).toBe(100);
  });

  test("scales linearly below the best", () => {
    expect(relativeToBest(50, 200)).toBe(25);
  });

  test("zero output against a positive best is a real zero", () => {
    expect(relativeToBest(0, 200)).toBe(0);
  });

  test("no top scorer means no scale, not a department-wide zero", () => {
    expect(relativeToBest(0, 0)).toBeNull();
    expect(relativeToBest(5, -1)).toBeNull();
  });
});

describe("ratingToScore", () => {
  test("maps the 1-5 scale across the full 0-100 range", () => {
    expect(ratingToScore(1)).toBe(0);
    expect(ratingToScore(3)).toBe(50);
    expect(ratingToScore(5)).toBe(100);
  });

  test("handles fractional averages", () => {
    expect(ratingToScore(3.5)).toBe(62.5);
  });

  test("no rating is unavailable", () => {
    expect(ratingToScore(null)).toBeNull();
  });
});

describe("ratioToScore", () => {
  test("is a plain percentage", () => {
    expect(ratioToScore(3, 4)).toBe(75);
  });

  test("an empty denominator is unavailable, not zero", () => {
    expect(ratioToScore(0, 0)).toBeNull();
  });

  test("cannot exceed 100", () => {
    expect(ratioToScore(5, 4)).toBe(100);
  });
});

describe("attendanceToScore", () => {
  const base = {
    presentDays: 0,
    halfDays: 0,
    holidayDays: 0,
    paidLeaveDays: 0,
    workingDaysElapsed: 0,
  };

  test("full attendance is 100", () => {
    expect(attendanceToScore({ ...base, presentDays: 20, workingDaysElapsed: 20 })).toBe(100);
  });

  test("half-days count half", () => {
    expect(
      attendanceToScore({ ...base, presentDays: 18, halfDays: 2, workingDaysElapsed: 20 }),
    ).toBe(95);
  });

  test("holidays and approved paid leave do not count against you", () => {
    expect(
      attendanceToScore({
        ...base,
        presentDays: 15,
        holidayDays: 2,
        paidLeaveDays: 3,
        workingDaysElapsed: 20,
      }),
    ).toBe(100);
  });

  test("absence pulls it down", () => {
    // 5 absent days are simply uncredited.
    expect(attendanceToScore({ ...base, presentDays: 15, workingDaysElapsed: 20 })).toBe(75);
  });

  test("a month that has not started yet is unavailable", () => {
    expect(attendanceToScore(base)).toBeNull();
  });
});

describe("clampScore", () => {
  test("bounds to 0-100 and rejects non-finite input", () => {
    expect(clampScore(-5)).toBe(0);
    expect(clampScore(140)).toBe(100);
    expect(clampScore(42)).toBe(42);
    expect(clampScore(NaN)).toBe(0);
  });
});
