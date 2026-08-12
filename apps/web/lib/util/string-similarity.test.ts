import { describe, expect, test } from "bun:test";
import { bestNameMatches, nameSimilarity } from "./string-similarity";

describe("nameSimilarity", () => {
  test("identical names are a perfect match", () => {
    expect(nameSimilarity("John Smith", "John Smith")).toBe(1);
  });

  test("case and whitespace differences don't affect the score", () => {
    expect(nameSimilarity("  John   Smith ", "john smith")).toBe(1);
  });

  test("a single-character typo scores close to but not exactly 1", () => {
    const score = nameSimilarity("John Smith", "Jon Smith");
    expect(score).toBeGreaterThan(0.85);
    expect(score).toBeLessThan(1);
  });

  test("unrelated names score low", () => {
    expect(nameSimilarity("John Smith", "Priya Patel")).toBeLessThan(0.3);
  });

  test("two empty strings are trivially equal", () => {
    expect(nameSimilarity("", "")).toBe(1);
  });
});

describe("bestNameMatches", () => {
  const options = [
    { id: "1", name: "John Smith" },
    { id: "2", name: "Jane Doe" },
    { id: "3", name: "Priya Patel" },
  ];

  test("ranks the closest name first", () => {
    const results = bestNameMatches("Jon Smith", options);
    expect(results[0].id).toBe("1");
  });

  test("respects the limit parameter", () => {
    const results = bestNameMatches("Jon Smith", options, 1);
    expect(results).toHaveLength(1);
  });

  test("empty options returns empty results", () => {
    expect(bestNameMatches("Jon Smith", [])).toEqual([]);
  });
});
