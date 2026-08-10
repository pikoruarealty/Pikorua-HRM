import { describe, expect, test } from "bun:test";
import { CrmSyncError, parseActivityResponse } from "./crm-client";

// The sample below is the shape verified live against the real CRM on
// 2026-08-09 (200, 24 rows). Keep it in sync if the CRM contract moves — their
// API is still under active development.
const SAMPLE = {
  reps: [
    { email: "asha.rao1994@gmail.com", name: "Asha Rao", date: "2026-08-09", callsMade: 42, siteVisits: 1, bookingsConfirmed: 0 },
    { email: "vikram.s@gmail.com", name: "Vikram Singh", date: "2026-08-09", callsMade: 0, siteVisits: 0, bookingsConfirmed: 0 },
  ],
};

describe("parseActivityResponse", () => {
  test("parses the verified real-world payload shape", () => {
    const rows = parseActivityResponse(SAMPLE);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      email: "asha.rao1994@gmail.com",
      name: "Asha Rao",
      date: "2026-08-09",
      callsMade: 42,
      siteVisits: 1,
      bookingsConfirmed: 0,
    });
  });

  test("an all-zero row is kept — the CRM emits confirmed zeros, not omissions", () => {
    const rows = parseActivityResponse(SAMPLE);
    expect(rows[1].callsMade).toBe(0);
    expect(rows).toHaveLength(2);
  });

  test("missing counts default to 0", () => {
    const rows = parseActivityResponse({
      reps: [{ email: "a@b.com", name: "A B", date: "2026-08-09" }],
    });
    expect(rows[0]).toMatchObject({ callsMade: 0, siteVisits: 0, bookingsConfirmed: 0 });
  });

  test("rejects a payload with no reps array", () => {
    expect(() => parseActivityResponse({ data: [] })).toThrow(CrmSyncError);
    expect(() => parseActivityResponse(null)).toThrow(CrmSyncError);
  });

  test("rejects a malformed date rather than silently mis-dating activity", () => {
    expect(() =>
      parseActivityResponse({ reps: [{ email: "a@b.com", name: "A", date: "09/08/2026" }] }),
    ).toThrow(/YYYY-MM-DD/);
  });

  test("rejects a negative or non-numeric count", () => {
    expect(() =>
      parseActivityResponse({ reps: [{ email: "a@b.com", name: "A", date: "2026-08-09", callsMade: -3 }] }),
    ).toThrow(/non-negative/);
    expect(() =>
      parseActivityResponse({ reps: [{ email: "a@b.com", name: "A", date: "2026-08-09", callsMade: "42" }] }),
    ).toThrow(/non-negative/);
  });

  test("rejects a row with neither email nor name — unattributable", () => {
    expect(() =>
      parseActivityResponse({ reps: [{ email: "", name: "", date: "2026-08-09" }] }),
    ).toThrow(/unattributable/);
  });

  test("tolerates a row missing an email as long as a name is present", () => {
    const rows = parseActivityResponse({
      reps: [{ name: "Asha Rao", date: "2026-08-09", callsMade: 5 }],
    });
    expect(rows[0].email).toBe("");
    expect(rows[0].name).toBe("Asha Rao");
  });
});
