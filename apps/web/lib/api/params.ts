// SHARED. Route-parameter and query-string validation (2026-08-11).
//
// Every `:id` in this API is a Postgres uuid column. Handing Prisma a string
// that isn't a UUID doesn't return "no rows" — it throws P2023 ("Inconsistent
// column data"), which escapes the handler as an unhandled error and Next
// turns into a bare 500 with no `{ data, error }` envelope. Twenty-two
// endpoints did that before this file existed: `GET /employees/not-a-uuid`
// answered 500, so a client could not tell a typo'd id from a genuinely
// broken server, and every crawler hitting a stale link looked like an
// outage in the logs.
//
// The answer is to reject the id at the boundary, before it reaches the
// database. A malformed id cannot name an existing row, so **404 is the
// honest status** — and it matches the posture the scoped read routes already
// take, where "not yours" and "doesn't exist" deliberately look identical.

/** Canonical 8-4-4-4-12 hex form. Deliberately not version-specific: the DB
 *  accepts any UUID, so validating the version here would reject ids Postgres
 *  would have been happy to store. */
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * Query-string uuid filter (`?employee_id=`, `?department_id=`). Returns:
 *   - `undefined` when the param is absent (no filter)
 *   - the value when it is a well-formed uuid
 *   - `null` when it is present but malformed — the caller must 422, because
 *     unlike a path id this is the client's *filter* that is wrong, and
 *     silently ignoring it would return an unfiltered list that looks like a
 *     successful narrow search.
 */
export function uuidFilter(value: string | null): string | undefined | null {
  if (value === null || value === "") return undefined;
  return isUuid(value) ? value : null;
}

/**
 * `?date_from=` / `?date_to=` style params. Same three-way contract as
 * `uuidFilter`: absent → undefined, valid → Date, malformed → null. A bad
 * date used to reach Prisma as `new Date("notadate")` (Invalid Date) and
 * throw, so `GET /attendance?date_from=notadate` was a 500.
 */
export function dateFilter(value: string | null): Date | undefined | null {
  if (value === null || value === "") return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * `?month=` / `?year=` and other bounded integers. Absent → undefined,
 * in-range → number, otherwise null. The range check matters as much as the
 * parse: `?month=99` used to sail through to a payroll period query that
 * could never match anything and answered 200 with an empty list, which reads
 * as "you have no payslips" rather than "that isn't a month".
 */
export function intFilter(
  value: string | null,
  min: number,
  max: number,
): number | undefined | null {
  if (value === null || value === "") return undefined;
  if (!/^-?\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

/** Enum-valued query param (`?status=`, `?type=`). Same three-way contract. */
export function enumFilter<T extends Record<string, string>>(
  value: string | null,
  enumObject: T,
): T[keyof T] | undefined | null {
  if (value === null || value === "") return undefined;
  const values = Object.values(enumObject) as string[];
  return values.includes(value) ? (value as T[keyof T]) : null;
}
