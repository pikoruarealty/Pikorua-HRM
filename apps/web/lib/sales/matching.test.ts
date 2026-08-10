import { describe, expect, test } from "bun:test";
import { SalesMatchMethod } from "@prisma/client";
import { buildMatchIndex, matchRow, normalizeEmail, normalizeName } from "./matching";

const EMPLOYEES = [
  { id: "e-asha", email: "Asha.Rao@pikoruarealty.com", fullName: "Asha Rao" },
  { id: "e-vikram", email: "vikram@pikoruarealty.com", fullName: "Vikram Singh" },
  // Two employees genuinely sharing a name — the ambiguity case.
  { id: "e-rahul-1", email: "rahul.s@pikoruarealty.com", fullName: "Rahul Sharma" },
  { id: "e-rahul-2", email: "rahul.sharma@pikoruarealty.com", fullName: "rahul  sharma" },
];

const index = buildMatchIndex(EMPLOYEES);

describe("normalisers", () => {
  test("email is trimmed and lowercased", () => {
    expect(normalizeEmail("  Asha.Rao@Pikoruarealty.com ")).toBe("asha.rao@pikoruarealty.com");
  });

  test("name collapses internal whitespace and lowercases", () => {
    expect(normalizeName("  Rahul   Sharma ")).toBe("rahul sharma");
  });

  test("null and undefined normalise to empty, not a crash", () => {
    expect(normalizeEmail(null)).toBe("");
    expect(normalizeName(undefined)).toBe("");
  });
});

describe("matchRow", () => {
  test("matches on email, case-insensitively", () => {
    const r = matchRow({ email: "ASHA.RAO@pikoruarealty.com", name: "Whoever" }, index);
    expect(r).toEqual({ employeeId: "e-asha", method: SalesMatchMethod.email });
  });

  test("email wins over a conflicting name", () => {
    // The feed's name is wrong but the email is authoritative.
    const r = matchRow({ email: "vikram@pikoruarealty.com", name: "Asha Rao" }, index);
    expect(r.employeeId).toBe("e-vikram");
    expect(r.method).toBe(SalesMatchMethod.email);
  });

  test("falls back to a unique name when the email is unknown", () => {
    // The real case: CRM holds personal Gmail addresses, not corporate ones.
    const r = matchRow({ email: "asha.rao1994@gmail.com", name: "asha rao" }, index);
    expect(r.employeeId).toBe("e-asha");
    expect(r.method).toBe(SalesMatchMethod.name);
  });

  test("refuses to guess when a name is ambiguous", () => {
    const r = matchRow({ email: "someone@gmail.com", name: "Rahul Sharma" }, index);
    expect(r.employeeId).toBeNull();
    expect(r.method).toBe(SalesMatchMethod.unmatched);
    expect(r.reason).toContain("2 employees");
  });

  test("unknown email and unknown name is unmatched, not an exception", () => {
    const r = matchRow({ email: "ghost@gmail.com", name: "Nobody At All" }, index);
    expect(r.employeeId).toBeNull();
    expect(r.method).toBe(SalesMatchMethod.unmatched);
  });

  test("does not reorder words to force a match", () => {
    // "Sharma Asha" is not proof of "Asha Rao" or of anyone else.
    const r = matchRow({ email: "x@gmail.com", name: "Rao Asha" }, index);
    expect(r.employeeId).toBeNull();
  });

  test("an empty email does not collide with an employee lacking one", () => {
    const sparse = buildMatchIndex([{ id: "e-x", email: "", fullName: "No Email" }]);
    const r = matchRow({ email: "", name: "someone else" }, sparse);
    expect(r.employeeId).toBeNull();
  });
});
