import { SalesMatchMethod } from "@prisma/client";

// Pillar 4 (2026-08-10) — attributing a CRM activity row to an HRM employee.
//
// Pure and DB-free so the rules are unit-testable, because getting this wrong
// is the one failure mode with no safe default: silently crediting one rep's
// calls to another is worse than recording nothing at all.
//
// Verified against a real 24-row sample from the CRM: reps are identified by
// personal Gmail addresses, NOT corporate ones, so the email join is expected
// to miss in practice and the name fallback is a real code path, not a
// theoretical edge case. Hence:
//
//  1. Email match (case-insensitive, trimmed) — authoritative.
//  2. Failing that, a case-insensitive full-name match — but ONLY when exactly
//     one active employee matches. Two "Rahul Sharma"s means we cannot know,
//     so the row is left unmatched rather than guessed.
//  3. Anything else is recorded as `unmatched` and surfaced to an admin.
//
// A row is never dropped. An unmatched row still lands in SalesActivitySync so
// somebody can see the feed mentions a person HRM does not recognise.

export type CrmActivityRow = {
  email: string;
  name: string;
  date: string; // YYYY-MM-DD
  callsMade: number;
  siteVisits: number;
  bookingsConfirmed: number;
};

export type MatchCandidate = {
  id: string;
  email: string;
  fullName: string;
};

export type MatchResult = {
  employeeId: string | null;
  method: SalesMatchMethod;
  /** Populated when a name was ambiguous — the reason it stayed unmatched. */
  reason?: string;
};

export function normalizeEmail(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

/** Case-insensitive, whitespace-collapsed name key. Deliberately does NOT strip
 *  punctuation or reorder words: "Sharma Rahul" is not proof of "Rahul Sharma",
 *  and a fuzzier match here would trade a miss (safe, visible) for a
 *  misattribution (silent, wrong). */
export function normalizeName(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Index employees once per sync rather than per row. */
export function buildMatchIndex(employees: MatchCandidate[]): {
  byEmail: Map<string, string>;
  byName: Map<string, string[]>;
} {
  const byEmail = new Map<string, string>();
  const byName = new Map<string, string[]>();

  for (const e of employees) {
    const emailKey = normalizeEmail(e.email);
    if (emailKey) byEmail.set(emailKey, e.id);

    const nameKey = normalizeName(e.fullName);
    if (!nameKey) continue;
    const list = byName.get(nameKey);
    if (list) list.push(e.id);
    else byName.set(nameKey, [e.id]);
  }

  return { byEmail, byName };
}

export function matchRow(
  row: Pick<CrmActivityRow, "email" | "name">,
  index: { byEmail: Map<string, string>; byName: Map<string, string[]> },
): MatchResult {
  const emailKey = normalizeEmail(row.email);
  const byEmail = emailKey ? index.byEmail.get(emailKey) : undefined;
  if (byEmail) return { employeeId: byEmail, method: SalesMatchMethod.email };

  const nameKey = normalizeName(row.name);
  const candidates = nameKey ? index.byName.get(nameKey) : undefined;
  if (candidates && candidates.length === 1) {
    return { employeeId: candidates[0], method: SalesMatchMethod.name };
  }
  if (candidates && candidates.length > 1) {
    return {
      employeeId: null,
      method: SalesMatchMethod.unmatched,
      reason: `Name "${row.name}" matches ${candidates.length} employees — refusing to guess.`,
    };
  }

  return {
    employeeId: null,
    method: SalesMatchMethod.unmatched,
    reason: `No employee matches email "${row.email}" or name "${row.name}".`,
  };
}
