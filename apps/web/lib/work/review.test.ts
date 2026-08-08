import { describe, expect, test, afterEach } from "bun:test";
import { requiresReview, reviewThreshold } from "@/lib/work/review";

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
