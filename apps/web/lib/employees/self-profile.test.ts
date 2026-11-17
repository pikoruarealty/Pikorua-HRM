import { describe, expect, test } from "bun:test";
import { isPlausibleBirthDate, validateSelfProfile } from "./self-profile";

const TODAY = "2026-11-17";

describe("isPlausibleBirthDate", () => {
  test("accepts a normal past date and today", () => {
    expect(isPlausibleBirthDate("1998-04-12", TODAY)).toBe(true);
    expect(isPlausibleBirthDate(TODAY, TODAY)).toBe(true);
  });
  test("rejects future, pre-1930, malformed and impossible dates", () => {
    expect(isPlausibleBirthDate("2026-11-18", TODAY)).toBe(false);
    expect(isPlausibleBirthDate("1929-12-31", TODAY)).toBe(false);
    expect(isPlausibleBirthDate("12/04/1998", TODAY)).toBe(false);
    expect(isPlausibleBirthDate("2001-02-30", TODAY)).toBe(false);
    expect(isPlausibleBirthDate("2001-13-01", TODAY)).toBe(false);
  });
  test("accepts a leap day only in a leap year", () => {
    expect(isPlausibleBirthDate("2000-02-29", TODAY)).toBe(true);
    expect(isPlausibleBirthDate("2001-02-29", TODAY)).toBe(false);
  });
});

describe("validateSelfProfile", () => {
  test("accepts name, phone and date of birth together", () => {
    const r = validateSelfProfile(
      { full_name: "  Asha Verma ", phone: "+91 98765-43210", date_of_birth: "1998-04-12" },
      TODAY,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.full_name).toBe("Asha Verma"); // trimmed
  });
  test("null clears phone and date of birth", () => {
    const r = validateSelfProfile({ phone: null, date_of_birth: null }, TODAY);
    expect(r.ok).toBe(true);
  });
  test("rejects an empty body", () => {
    expect(validateSelfProfile({}, TODAY).ok).toBe(false);
  });
  test("rejects a blank or over-long name", () => {
    expect(validateSelfProfile({ full_name: "   " }, TODAY).ok).toBe(false);
    expect(validateSelfProfile({ full_name: "x".repeat(101) }, TODAY).ok).toBe(false);
  });
  test("rejects bad phone numbers", () => {
    for (const phone of ["abc", "12345", "+", "98765 4321 0987 6543", "98765#43210", ""]) {
      expect(validateSelfProfile({ phone }, TODAY).ok).toBe(false);
    }
  });
  test("rejects a future or impossible date of birth", () => {
    expect(validateSelfProfile({ date_of_birth: "2027-01-01" }, TODAY).ok).toBe(false);
    expect(validateSelfProfile({ date_of_birth: "2001-02-30" }, TODAY).ok).toBe(false);
  });
  test("mass-assignment guard: admin-only fields are rejected, not ignored", () => {
    for (const key of ["email", "role", "base_salary", "department_id", "team_id", "status", "date_of_joining", "wfh_allowed", "device_uid"]) {
      const r = validateSelfProfile({ full_name: "Asha", [key]: "x" }, TODAY);
      expect(r.ok).toBe(false);
    }
  });
});
