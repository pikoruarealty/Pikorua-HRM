import { describe, expect, test } from "bun:test";
import { allocateCompensationCredits } from "./compensation-credits";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("allocateCompensationCredits", () => {
  test("matches a single leave day against a single covering credit", () => {
    const redemptions = allocateCompensationCredits(
      [{ date: d("2026-07-10"), requestId: "req-1" }],
      [{ id: "credit-1", earnedDate: d("2026-07-01"), expiresAt: d("2026-08-30") }],
    );
    expect(redemptions).toEqual([{ creditId: "credit-1", date: d("2026-07-10"), requestId: "req-1" }]);
  });

  test("leave date before the credit was earned is not redeemed", () => {
    const redemptions = allocateCompensationCredits(
      [{ date: d("2026-06-30"), requestId: "req-1" }],
      [{ id: "credit-1", earnedDate: d("2026-07-01"), expiresAt: d("2026-08-30") }],
    );
    expect(redemptions).toEqual([]);
  });

  test("leave date past expiry is not redeemed", () => {
    const redemptions = allocateCompensationCredits(
      [{ date: d("2026-09-01"), requestId: "req-1" }],
      [{ id: "credit-1", earnedDate: d("2026-07-01"), expiresAt: d("2026-08-30") }],
    );
    expect(redemptions).toEqual([]);
  });

  test("leave date exactly on earnedDate or expiresAt is redeemed (inclusive bounds)", () => {
    const credit = { id: "credit-1", earnedDate: d("2026-07-01"), expiresAt: d("2026-08-30") };
    expect(
      allocateCompensationCredits([{ date: d("2026-07-01"), requestId: "req-1" }], [credit]),
    ).toEqual([{ creditId: "credit-1", date: d("2026-07-01"), requestId: "req-1" }]);
    expect(
      allocateCompensationCredits([{ date: d("2026-08-30"), requestId: "req-1" }], [credit]),
    ).toEqual([{ creditId: "credit-1", date: d("2026-08-30"), requestId: "req-1" }]);
  });

  test("each credit is used at most once, even with multiple eligible leave days", () => {
    const redemptions = allocateCompensationCredits(
      [
        { date: d("2026-07-05"), requestId: "req-1" },
        { date: d("2026-07-06"), requestId: "req-1" },
      ],
      [{ id: "credit-1", earnedDate: d("2026-07-01"), expiresAt: d("2026-08-30") }],
    );
    expect(redemptions).toEqual([{ creditId: "credit-1", date: d("2026-07-05"), requestId: "req-1" }]);
  });

  test("prefers the soonest-expiring covering credit, leaving the longer-lived one available", () => {
    const redemptions = allocateCompensationCredits(
      [{ date: d("2026-07-10"), requestId: "req-1" }],
      [
        { id: "expires-later", earnedDate: d("2026-06-01"), expiresAt: d("2026-09-01") },
        { id: "expires-soon", earnedDate: d("2026-06-01"), expiresAt: d("2026-07-15") },
      ],
    );
    expect(redemptions).toEqual([{ creditId: "expires-soon", date: d("2026-07-10"), requestId: "req-1" }]);
  });

  test("multiple leave days each get a distinct credit, oldest leave day first", () => {
    const redemptions = allocateCompensationCredits(
      [
        { date: d("2026-07-20"), requestId: "req-2" },
        { date: d("2026-07-10"), requestId: "req-1" },
      ],
      [
        { id: "credit-a", earnedDate: d("2026-07-01"), expiresAt: d("2026-08-30") },
        { id: "credit-b", earnedDate: d("2026-07-01"), expiresAt: d("2026-08-30") },
      ],
    );
    expect(redemptions).toHaveLength(2);
    const byDate = new Map(redemptions.map((r) => [r.date.toISOString().slice(0, 10), r.creditId]));
    expect(byDate.get("2026-07-10")).not.toBe(byDate.get("2026-07-20"));
  });

  test("empty inputs return no redemptions", () => {
    expect(allocateCompensationCredits([], [])).toEqual([]);
    expect(
      allocateCompensationCredits([{ date: d("2026-07-10"), requestId: "req-1" }], []),
    ).toEqual([]);
  });

  test("a leave day with no covering credit is skipped, not force-matched", () => {
    const redemptions = allocateCompensationCredits(
      [{ date: d("2026-07-10"), requestId: "req-1" }],
      [{ id: "credit-1", earnedDate: d("2026-08-01"), expiresAt: d("2026-09-30") }],
    );
    expect(redemptions).toEqual([]);
  });
});
