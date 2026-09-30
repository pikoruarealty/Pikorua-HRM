import { describe, expect, test } from "bun:test";
import { computeExpectedHours, shiftHoursFor } from "./expected-hours";

describe("shiftHoursFor", () => {
  test("derives hours from the team's start and end", () => {
    expect(shiftHoursFor("11:00", "19:00")).toBe(8);
    expect(shiftHoursFor("09:30", "18:00")).toBe(8.5);
  });

  test("falls back to 8 when unset or nonsensical", () => {
    expect(shiftHoursFor(null, null)).toBe(8);
    expect(shiftHoursFor("19:00", "11:00")).toBe(8);
    expect(shiftHoursFor("later", "19:00")).toBe(8);
  });
});

describe("computeExpectedHours", () => {
  test("the owner's example: 3 office days x 8h + 6h WFH = 30h a week = 120h a month", () => {
    const r = computeExpectedHours({
      employmentType: "parttime",
      requiredDaysPerWeek: 3,
      expectedWfhHoursPerWeek: 6,
      shiftHours: 8,
      workingDaysInMonth: 26,
    });
    expect(r).toEqual({ month: 120, weekly: 30, wfhWeekly: 6 });
  });

  test("a part-timer with no WFH target is just days x shift", () => {
    const r = computeExpectedHours({
      employmentType: "intern",
      requiredDaysPerWeek: 3,
      expectedWfhHoursPerWeek: null,
      shiftHours: 8,
      workingDaysInMonth: 26,
    });
    expect(r).toEqual({ month: 96, weekly: 24, wfhWeekly: null });
  });

  test("a full-timer's month is their expected working days x the shift", () => {
    const r = computeExpectedHours({
      employmentType: "fulltime",
      requiredDaysPerWeek: null,
      expectedWfhHoursPerWeek: null,
      shiftHours: 8,
      workingDaysInMonth: 26,
    });
    expect(r).toEqual({ month: 208, weekly: null, wfhWeekly: null });
  });

  test("a stale WFH target on a full-timer is ignored", () => {
    const r = computeExpectedHours({
      employmentType: "fulltime",
      requiredDaysPerWeek: null,
      expectedWfhHoursPerWeek: 10,
      shiftHours: 8,
      workingDaysInMonth: 25,
    });
    expect(r.month).toBe(200);
    expect(r.wfhWeekly).toBeNull();
  });
});
