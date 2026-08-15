import { describe, expect, it } from "bun:test";
import { cappedSelfLoggedPoints } from "@/lib/work/adhoc";
import { requiresReviewForItem } from "@/lib/work/review";

describe("cappedSelfLoggedPoints", () => {
  it("lets self-logged points through when they are under the share", () => {
    // 30% of 100 = 30; 10 self-logged points are comfortably inside it.
    expect(cappedSelfLoggedPoints({ selfLoggedPoints: 10, totalPoints: 100, capPercent: 30 })).toEqual({
      allowed: 10,
      excluded: 0,
    });
  });

  it("clips the excess once self-logged work passes the share", () => {
    expect(cappedSelfLoggedPoints({ selfLoggedPoints: 50, totalPoints: 100, capPercent: 30 })).toEqual({
      allowed: 30,
      excluded: 20,
    });
  });

  it("allows nothing when there is no assigned work at all", () => {
    // 30% of 30 is 9 — a month of purely self-logged work is mostly discounted.
    // This is the intended reading (ad-hoc supplements assigned work), and is
    // why the grace period exists before scoring is switched on.
    expect(cappedSelfLoggedPoints({ selfLoggedPoints: 30, totalPoints: 30, capPercent: 30 })).toEqual({
      allowed: 9,
      excluded: 21,
    });
  });

  it("rounds the ceiling down, never up", () => {
    // 30% of 11 = 3.3 → 3. Rounding up would hand out a point nobody earned.
    expect(cappedSelfLoggedPoints({ selfLoggedPoints: 11, totalPoints: 11, capPercent: 30 }).allowed).toBe(3);
  });

  it("treats a 100% cap as no cap and a 0% cap as a total block", () => {
    expect(cappedSelfLoggedPoints({ selfLoggedPoints: 40, totalPoints: 40, capPercent: 100 }).allowed).toBe(40);
    expect(cappedSelfLoggedPoints({ selfLoggedPoints: 40, totalPoints: 40, capPercent: 0 }).allowed).toBe(0);
  });

  it("clamps a nonsensical configured percentage instead of trusting it", () => {
    expect(cappedSelfLoggedPoints({ selfLoggedPoints: 40, totalPoints: 40, capPercent: 500 }).allowed).toBe(40);
    expect(cappedSelfLoggedPoints({ selfLoggedPoints: 40, totalPoints: 40, capPercent: -20 }).allowed).toBe(0);
  });

  it("is a no-op when nothing was self-logged", () => {
    expect(cappedSelfLoggedPoints({ selfLoggedPoints: 0, totalPoints: 80, capPercent: 30 })).toEqual({
      allowed: 0,
      excluded: 0,
    });
  });
});

describe("requiresReviewForItem", () => {
  it("always reviews catalog self-logged work, however small", () => {
    // 1 point is far below the threshold, but nobody except the employee has
    // said this task exists — a human picked the catalog price, not an
    // estimate, so the Lead's yes/no is the only check there is.
    expect(requiresReviewForItem({ taskPoints: 1, selfLogged: true, adhocTypeId: "bug_fix" })).toBe(true);
  });

  it("leaves free-text self-logged work on the ordinary threshold", () => {
    // Free-text is AI-priced the same way assigned work is (2026-08-14) —
    // small estimates credit immediately, only large ones go to a Lead.
    expect(requiresReviewForItem({ taskPoints: 1, selfLogged: true, adhocTypeId: null })).toBe(false);
    expect(requiresReviewForItem({ taskPoints: 8, selfLogged: true, adhocTypeId: null })).toBe(true);
  });

  it("leaves assigned work on the ordinary threshold", () => {
    expect(requiresReviewForItem({ taskPoints: 1, selfLogged: false })).toBe(false);
    expect(requiresReviewForItem({ taskPoints: 8, selfLogged: false })).toBe(true);
  });

  it("does not gate metric items, which carry no points", () => {
    expect(requiresReviewForItem({ taskPoints: null })).toBe(false);
  });
});
