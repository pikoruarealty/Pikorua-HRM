import { describe, expect, test } from "bun:test";
import { reviewCreditDate } from "./review";

// 2026-10-24: a task approved after review counts for the day it was submitted.

const submitted = new Date("2026-10-20T09:30:00.000Z");
const approved = new Date("2026-10-23T15:00:00.000Z");

describe("reviewCreditDate", () => {
  test("a task that sat in review counts for the day it was submitted, not approved", () => {
    expect(reviewCreditDate(true, submitted, approved)).toEqual(submitted);
  });

  test("approved the same day it was submitted: same moment either way", () => {
    expect(reviewCreditDate(true, submitted, new Date("2026-10-20T18:00:00.000Z"))).toEqual(submitted);
  });

  test("a task that never went through review counts when it is completed", () => {
    expect(reviewCreditDate(false, submitted, approved)).toEqual(approved);
    // A stale submit date from an earlier, rejected submission must not be reused.
    expect(reviewCreditDate(false, new Date("2026-09-01T00:00:00.000Z"), approved)).toEqual(approved);
  });

  test("no submit date recorded (older rows): falls back to now", () => {
    expect(reviewCreditDate(true, null, approved)).toEqual(approved);
    expect(reviewCreditDate(true, undefined, approved)).toEqual(approved);
  });

  test("a submit date in the future is never honoured", () => {
    expect(reviewCreditDate(true, new Date("2026-12-01T00:00:00.000Z"), approved)).toEqual(approved);
  });

  test("approval across a month boundary credits the earlier month", () => {
    const lateSubmit = new Date("2026-09-30T10:00:00.000Z");
    const credited = reviewCreditDate(true, lateSubmit, new Date("2026-10-02T10:00:00.000Z"));
    expect(credited.getUTCMonth()).toBe(8); // September
  });
});
