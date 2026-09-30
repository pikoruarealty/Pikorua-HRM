import { describe, expect, test } from "bun:test";
import { isMetricDepartment } from "./type";

describe("isMetricDepartment", () => {
  test("matches sales and bd", () => {
    expect(isMetricDepartment("sales")).toBe(true);
    expect(isMetricDepartment("bd")).toBe(true);
  });

  test("ignores case and surrounding whitespace — production's Sales department is stored as 'Sales'", () => {
    // Exact-match used to fail here, scoring the whole sales team as a
    // task-points department (and every recognition score as 0).
    expect(isMetricDepartment("Sales")).toBe(true);
    expect(isMetricDepartment("BD")).toBe(true);
    expect(isMetricDepartment("  SALES ")).toBe(true);
  });

  test("anything else is not a metric department", () => {
    expect(isMetricDepartment("tech")).toBe(false);
    expect(isMetricDepartment("AI Tech")).toBe(false);
    expect(isMetricDepartment("presales")).toBe(false);
    expect(isMetricDepartment(null)).toBe(false);
    expect(isMetricDepartment(undefined)).toBe(false);
  });
});
