import { z } from "zod";

// Employee self-service profile (2026-11-17). An employee may edit ONLY their
// own name, phone and date of birth (plus their photo, via
// POST /employees/:id/photo). Everything else on `employees` — email (it is
// also the login), role, salary, department, joining date, WFH switch — stays
// Admin/HR. The schema is `.strict()` so an unknown key (e.g. `base_salary`,
// `role`, `email`) is a 422, never silently ignored: this is the
// mass-assignment surface that must not widen.

const PHONE_PATTERN = /^\+?[0-9][0-9 ()-]*$/;
const MIN_BIRTH_YEAR = 1930;

/** Digits in a phone string (ignores +, spaces, dashes, brackets). */
function phoneDigits(value: string): number {
  return value.replace(/\D/g, "").length;
}

/**
 * `YYYY-MM-DD` that is a real calendar date, not in the future relative to
 * `today` (also `YYYY-MM-DD`), and not before MIN_BIRTH_YEAR.
 */
export function isPlausibleBirthDate(value: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== m - 1 || parsed.getUTCDate() !== d) {
    return false; // e.g. 2001-02-30
  }
  if (y < MIN_BIRTH_YEAR) return false;
  return value <= today;
}

export const selfProfileSchema = z
  .object({
    full_name: z
      .string()
      .trim()
      .min(1, "Name cannot be empty.")
      .max(100, "Name is too long (100 characters max).")
      .optional(),
    phone: z
      .string()
      .trim()
      .max(20, "Phone number is too long.")
      .refine((v) => PHONE_PATTERN.test(v) && phoneDigits(v) >= 7 && phoneDigits(v) <= 15, {
        message: "Enter a valid phone number (7–15 digits, optional leading +).",
      })
      .nullable()
      .optional(),
    // `null` clears it. Range/real-date checks need "today", so they run in
    // `validateSelfProfile` rather than in the static schema.
    date_of_birth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be YYYY-MM-DD.")
      .nullable()
      .optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: "Nothing to update." });

export type SelfProfileInput = z.infer<typeof selfProfileSchema>;

export type SelfProfileResult =
  | { ok: true; data: SelfProfileInput }
  | { ok: false; message: string };

/** Parse + validate a self-profile body. `today` is `YYYY-MM-DD` (server clock). */
export function validateSelfProfile(body: unknown, today: string): SelfProfileResult {
  const parsed = selfProfileSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid request body." };
  }
  const dob = parsed.data.date_of_birth;
  if (dob && !isPlausibleBirthDate(dob, today)) {
    return { ok: false, message: "Enter a valid date of birth (a real date, not in the future)." };
  }
  return { ok: true, data: parsed.data };
}
