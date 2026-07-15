// Password policy for self-service password changes (production hardening,
// 2026-07-15). Kept out of lib/auth (shared Phase 0 module) on purpose —
// lib/auth stays hashing/session only; policy is a product rule that can
// evolve without touching the shared surface.

export const PASSWORD_MIN_LENGTH = 10;

export type PasswordCheck = { ok: true } | { ok: false; reason: string };

export function checkPasswordStrength(password: string): PasswordCheck {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, reason: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) {
    return { ok: false, reason: "Password must contain both upper- and lower-case letters." };
  }
  if (!/[0-9]/.test(password)) {
    return { ok: false, reason: "Password must contain at least one digit." };
  }
  return { ok: true };
}
