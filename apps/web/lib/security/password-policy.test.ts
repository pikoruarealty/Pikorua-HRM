import { describe, expect, test } from "bun:test";
import { checkPasswordStrength } from "./password-policy";

describe("checkPasswordStrength", () => {
  test("accepts a compliant password", () => {
    expect(checkPasswordStrength("CorrectHorse7").ok).toBe(true);
  });

  test("rejects short passwords", () => {
    expect(checkPasswordStrength("Ab1short").ok).toBe(false);
  });

  test("requires both cases", () => {
    expect(checkPasswordStrength("alllowercase7").ok).toBe(false);
    expect(checkPasswordStrength("ALLUPPERCASE7").ok).toBe(false);
  });

  test("requires a digit", () => {
    expect(checkPasswordStrength("NoDigitsHere").ok).toBe(false);
  });

  test("failure includes a human-readable reason", () => {
    const result = checkPasswordStrength("short");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
  });
});
