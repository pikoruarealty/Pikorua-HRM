import { createLogger } from "@/lib/log";
import type { CrmActivityRow } from "@/lib/sales/matching";

// Pillar 4 (2026-08-10) — thin client for the in-house CRM's HRM activity feed.
//
// Endpoint (verified live against the real CRM on 2026-08-09, 200 with a 24-row
// sample):
//   GET {CRM_API_BASE_URL}/api/hrm/activity?from=YYYY-MM-DD&to=YYYY-MM-DD
//   Authorization: Bearer {CRM_API_KEY}
//   -> { "reps": [ { email, name, date, callsMade, siteVisits, bookingsConfirmed } ] }
//
// Two things about this endpoint that are NOT obvious and cost a session to
// learn — do not re-derive them the hard way:
//
//  1. Access is IP-allowlisted to the production GCP VM. From a dev machine
//     this returns 401, which looks exactly like a bad API key and is not.
//     A 401 here is far more likely to be "wrong IP" than "wrong token".
//  2. A rep with no activity comes back as an explicit all-zero row, not an
//     omitted one. Present-and-zero means "confirmed zero"; absent means "no
//     data". The sync must not conflate them.
//
// The CRM is still under active development on their side (a Postgres bug in
// their getActivity was fixed mid-integration), so the response is parsed
// defensively and a shape change is reported as a clean error rather than
// throwing somewhere deep in the sync.

const logger = createLogger("crm-client");

export class CrmSyncError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CrmSyncError";
  }
}

function isFiniteCount(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

/** Coerce a count, treating a missing/garbage value as 0 but a negative or
 *  non-numeric one as a shape violation worth reporting. */
function count(value: unknown, field: string, at: number): number {
  if (value === undefined || value === null) return 0;
  if (!isFiniteCount(value)) {
    throw new CrmSyncError(`CRM row ${at}: "${field}" is not a non-negative number (got ${JSON.stringify(value)}).`);
  }
  return Math.trunc(value);
}

export function parseActivityResponse(payload: unknown): CrmActivityRow[] {
  if (!payload || typeof payload !== "object") {
    throw new CrmSyncError("CRM response was not a JSON object.");
  }
  const reps = (payload as { reps?: unknown }).reps;
  if (!Array.isArray(reps)) {
    throw new CrmSyncError('CRM response is missing the "reps" array.');
  }

  return reps.map((raw, i) => {
    if (!raw || typeof raw !== "object") {
      throw new CrmSyncError(`CRM row ${i}: expected an object.`);
    }
    const r = raw as Record<string, unknown>;
    const email = typeof r.email === "string" ? r.email : "";
    const name = typeof r.name === "string" ? r.name : "";
    const date = typeof r.date === "string" ? r.date : "";

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new CrmSyncError(`CRM row ${i}: "date" is not YYYY-MM-DD (got ${JSON.stringify(r.date)}).`);
    }
    if (!email && !name) {
      throw new CrmSyncError(`CRM row ${i}: has neither an email nor a name — unattributable.`);
    }

    return {
      email,
      name,
      date,
      callsMade: count(r.callsMade, "callsMade", i),
      siteVisits: count(r.siteVisits, "siteVisits", i),
      bookingsConfirmed: count(r.bookingsConfirmed, "bookingsConfirmed", i),
    };
  });
}

export function crmConfigured(): boolean {
  return Boolean(process.env.CRM_API_BASE_URL && process.env.CRM_API_KEY);
}

export async function fetchActivity(from: string, to: string): Promise<CrmActivityRow[]> {
  const base = process.env.CRM_API_BASE_URL;
  const key = process.env.CRM_API_KEY;
  if (!base || !key) {
    throw new CrmSyncError("CRM_API_BASE_URL / CRM_API_KEY are not configured.");
  }

  const url = `${base.replace(/\/+$/, "")}/api/hrm/activity?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  logger.debug("fetching CRM activity", { from, to });

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new CrmSyncError(`CRM request failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const hint =
      res.status === 401 || res.status === 403
        ? " (the CRM is IP-allowlisted to the production VM — from anywhere else this is expected and does NOT mean the API key is wrong)"
        : "";
    throw new CrmSyncError(`CRM returned ${res.status}${hint}: ${body.slice(0, 300)}`, res.status);
  }

  return parseActivityResponse(await res.json());
}
