import { describe, expect, test } from "bun:test";
import { WorkLocation } from "@prisma/client";
import { allocateCompensationCredits, canCreditCover, creditLocationOf } from "./compensation-credits";

// 2026-10-24 owner rule: an in-office day can be made up in the office only; a
// WFH day can be made up either way (office or WFH).

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const O = WorkLocation.office;
const W = WorkLocation.wfh;
const credit = (id: string, workLocation: WorkLocation, expires = "2026-08-30") => ({
  id,
  earnedDate: d("2026-07-01"),
  expiresAt: d(expires),
  workLocation,
});

describe("location rule: office covers both, WFH covers only WFH", () => {
  test("canCreditCover table", () => {
    expect(canCreditCover(O, O)).toBe(true);
    expect(canCreditCover(O, W)).toBe(true);
    expect(canCreditCover(W, W)).toBe(true);
    expect(canCreditCover(W, O)).toBe(false);
  });

  test("a WFH credit cannot cover an in-office absence", () => {
    const r = allocateCompensationCredits([{ date: d("2026-07-10"), location: O }], [], [credit("w", W)]);
    expect(r).toEqual([]);
  });

  test("a day without a location is an office day (old callers behave as before)", () => {
    expect(allocateCompensationCredits([{ date: d("2026-07-10") }], [], [credit("w", W)])).toEqual([]);
    expect(allocateCompensationCredits([{ date: d("2026-07-10") }], [], [credit("o", O)])).toHaveLength(1);
  });

  test("a credit without a location is an office credit (old callers behave as before)", () => {
    const bare = { id: "x", earnedDate: d("2026-07-01"), expiresAt: d("2026-08-30") };
    expect(allocateCompensationCredits([{ date: d("2026-07-10"), location: O }], [], [bare])).toHaveLength(1);
  });

  test("an office credit covers a WFH day, and a WFH credit covers a WFH day", () => {
    expect(allocateCompensationCredits([{ date: d("2026-07-10"), location: W }], [], [credit("o", O)])).toHaveLength(1);
    expect(allocateCompensationCredits([{ date: d("2026-07-10"), location: W }], [], [credit("w", W)])).toHaveLength(1);
  });

  test("for a WFH day the WFH credit is spent first, keeping the office credit for an office day", () => {
    const r = allocateCompensationCredits(
      [
        { date: d("2026-07-10"), location: W },
        { date: d("2026-07-11"), location: O },
      ],
      [],
      // The office credit expires first, so without the preference it would be taken by the WFH day.
      [credit("o", O, "2026-08-10"), credit("w", W, "2026-08-30")],
    );
    expect(r.map((x) => [x.creditId, x.date.toISOString().slice(0, 10)])).toEqual([
      ["w", "2026-07-10"],
      ["o", "2026-07-11"],
    ]);
  });

  test("with only an office credit, the WFH day takes it and the later office day goes uncovered", () => {
    const r = allocateCompensationCredits(
      [
        { date: d("2026-07-10"), location: W },
        { date: d("2026-07-11"), location: O },
      ],
      [],
      [credit("o", O)],
    );
    expect(r).toHaveLength(1);
    expect(r[0]!.date.toISOString().slice(0, 10)).toBe("2026-07-10");
  });

  test("unpaid-leave days follow the same rule", () => {
    const r = allocateCompensationCredits(
      [],
      [{ date: d("2026-07-10"), requestId: "req-1", location: O }],
      [credit("w", W)],
    );
    expect(r).toEqual([]);
  });

  test("absences are still matched before unpaid-leave days", () => {
    const r = allocateCompensationCredits(
      [{ date: d("2026-07-12"), location: O }],
      [{ date: d("2026-07-10"), requestId: "req-1", location: O }],
      [credit("o", O)],
    );
    expect(r).toHaveLength(1);
    expect(r[0]!.kind).toBe("absence");
  });
});

describe("creditLocationOf", () => {
  const at = (iso: string) => new Date(iso);
  const session = (workLocation: WorkLocation, from: string, to: string) => ({
    clockIn: at(from),
    clockOut: at(to),
    workLocation,
  });

  test("a day worked wholly from home earns a WFH credit", () => {
    expect(
      creditLocationOf({
        totalHours: 8,
        workLocation: W,
        sessions: [session(W, "2026-07-12T05:00:00Z", "2026-07-12T13:00:00Z")],
      }),
    ).toBe(W);
  });

  test("any office time makes it an office credit", () => {
    expect(
      creditLocationOf({
        totalHours: 8,
        workLocation: O,
        sessions: [
          session(W, "2026-07-12T04:00:00Z", "2026-07-12T08:00:00Z"),
          session(O, "2026-07-12T09:00:00Z", "2026-07-12T13:00:00Z"),
        ],
      }),
    ).toBe(O);
  });

  test("a record with no sessions uses its own location", () => {
    expect(creditLocationOf({ totalHours: 8, workLocation: W, sessions: [] })).toBe(W);
    expect(creditLocationOf({ totalHours: 8, workLocation: O, sessions: [] })).toBe(O);
  });
});
