import { describe, expect, test, afterEach } from "bun:test";
import {
  MIN_AWARD_CEILING,
  maxAwardablePoints,
  requiresReview,
  reviewThreshold,
} from "@/lib/work/review";

const ENV_KEY = "WORK_ITEM_REVIEW_THRESHOLD";

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe("reviewThreshold", () => {
  test("defaults to 3", () => {
    expect(reviewThreshold()).toBe(3);
  });

  test("reads a valid override from the environment", () => {
    process.env[ENV_KEY] = "5";
    expect(reviewThreshold()).toBe(5);
  });

  test("falls back to the default for junk or negative values", () => {
    process.env[ENV_KEY] = "not-a-number";
    expect(reviewThreshold()).toBe(3);
    process.env[ENV_KEY] = "-1";
    expect(reviewThreshold()).toBe(3);
  });
});

describe("requiresReview", () => {
  test("gates only tasks strictly above the threshold", () => {
    expect(requiresReview(1)).toBe(false);
    expect(requiresReview(3)).toBe(false);
    expect(requiresReview(4)).toBe(true);
    expect(requiresReview(13)).toBe(true);
  });

  test("never gates metric-mode items (null points)", () => {
    expect(requiresReview(null)).toBe(false);
    expect(requiresReview(undefined)).toBe(false);
  });

  test("respects the override", () => {
    process.env[ENV_KEY] = "10";
    expect(requiresReview(8)).toBe(false);
    expect(requiresReview(11)).toBe(true);
  });

  test("a threshold of 0 gates every points-bearing task", () => {
    process.env[ENV_KEY] = "0";
    expect(requiresReview(1)).toBe(true);
    expect(requiresReview(null)).toBe(false);
  });
});

describe("maxAwardablePoints", () => {
  test("allows double the nominal size for a substantial task", () => {
    expect(maxAwardablePoints(8)).toBe(16);
    expect(maxAwardablePoints(50)).toBe(100);
  });

  test("small tasks still get a meaningful ceiling, not double-of-tiny", () => {
    expect(maxAwardablePoints(1)).toBe(MIN_AWARD_CEILING);
    expect(maxAwardablePoints(3)).toBe(MIN_AWARD_CEILING);
    // 6 doubles to 12, which is above the floor, so the floor stops applying.
    expect(maxAwardablePoints(6)).toBe(12);
  });

  test("treats a missing nominal as zero and falls back to the floor", () => {
    expect(maxAwardablePoints(null)).toBe(MIN_AWARD_CEILING);
    expect(maxAwardablePoints(undefined)).toBe(MIN_AWARD_CEILING);
    expect(maxAwardablePoints(0)).toBe(MIN_AWARD_CEILING);
  });

  test("rejects the unbounded award that motivated it", () => {
    expect(99999 > maxAwardablePoints(8)).toBe(true);
    expect(88888 > maxAwardablePoints(1)).toBe(true);
  });
});
