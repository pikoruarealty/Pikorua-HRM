// TeamOffice biometric device integration (2026-08-12, Phase 28). Thin
// wrapper over the vendor's cloud REST API (see
// teamoffice_API_documentation.pdf in the repo root, gitignored). Uses the
// global `fetch`, no SDK dependency.
//
// Config via env (see .env.example):
//   TEAM_OFFICE_CORPORATE_ID / TEAM_OFFICE_USERNAME / TEAM_OFFICE_PASSWORD
//     — required; already in .env.
//   TEAM_OFFICE_BASE_URL — optional; defaults to the documented base URL.

import { createLogger } from "@/lib/log";

const DEFAULT_BASE_URL = "https://api.etimeoffice.com/api/";
const DEFAULT_TIMEOUT_MS = 30_000;

const logger = createLogger("teamoffice");

export class TeamOfficeApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "TeamOfficeApiError";
  }
}

export type TeamOfficePunch = {
  name: string | null;
  empcode: string;
  /** Parsed from the vendor's "dd/MM/yyyy HH:mm:ss" PunchDate. */
  punchTime: Date;
  id: number | null;
};

export type TeamOfficeLastPunchResult = {
  punches: TeamOfficePunch[];
  /** New cursor to persist — pass verbatim into the next call's LastRecord. */
  maxRecord: string | null;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new TeamOfficeApiError(`${name} is not configured on the server.`);
  }
  return value;
}

function authHeader(): string {
  const corporateId = requiredEnv("TEAM_OFFICE_CORPORATE_ID");
  const username = requiredEnv("TEAM_OFFICE_USERNAME");
  const password = requiredEnv("TEAM_OFFICE_PASSWORD");
  // Documented format: "Corporateid:Username:Password:True" (literal 4th
  // segment), base64-encoded.
  const raw = `${corporateId}:${username}:${password}:True`;
  return `Basic ${Buffer.from(raw, "utf-8").toString("base64")}`;
}

function baseUrl(): string {
  return process.env.TEAM_OFFICE_BASE_URL ?? DEFAULT_BASE_URL;
}

/** Format a Date as the vendor's query-parameter format: dd/MM/yyyy_HH:mm. */
export function formatQueryDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}_${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parse the vendor's response PunchDate format: "dd/MM/yyyy HH:mm:ss". The
 *  device sits in the office in India, so these digits are always IST
 *  wall-clock — building the Date via `new Date(y, m, d, h, min, s)` (which
 *  interprets the fields in the SERVER PROCESS's local timezone) only gives
 *  the right instant if that process happens to be running with TZ set to
 *  Asia/Kolkata. Nothing in this repo sets TZ, and most hosts default to
 *  UTC, so that constructor silently shifted every punch by the server's
 *  UTC-vs-IST offset (2026-08-14: root cause of biometric clock-ins showing
 *  a frozen/wrong "clocked in" state — the shifted instant lands the record
 *  under the wrong calendar day relative to the employee's actual IST
 *  browser). Building an explicit +05:30 ISO string makes the resulting
 *  instant correct regardless of the server's own timezone. */
export function parsePunchDate(s: string): Date {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})[ _](\d{2}):(\d{2}):(\d{2})$/.exec(s.trim());
  if (!m) throw new TeamOfficeApiError(`Unrecognised PunchDate format: "${s}"`);
  const [, dd, mm, yyyy, hh, min, ss] = m;
  return new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}+05:30`);
}

async function get(path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(path, baseUrl());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new TeamOfficeApiError("TeamOffice request timed out.");
    }
    throw new TeamOfficeApiError(
      `TeamOffice request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timeout);
  }

  const bodyText = await res.text().catch(() => "");
  if (!res.ok) {
    logger.error("non-200 response", { path, status: res.status, body: bodyText.slice(0, 500) });
    throw new TeamOfficeApiError(`TeamOffice API error ${res.status}: ${bodyText.slice(0, 500)}`, res.status);
  }
  try {
    return JSON.parse(bodyText);
  } catch {
    throw new TeamOfficeApiError("TeamOffice returned a non-JSON response.");
  }
}

/** API 4 — DownloadLastPunchData. The incremental-sync endpoint: pass the
 *  last persisted cursor, get back only new punches plus a new cursor to
 *  persist. This is the only endpoint the polling cron uses. */
export async function downloadLastPunchData(lastRecord: string): Promise<TeamOfficeLastPunchResult> {
  const payload = (await get("DownloadLastPunchData", {
    Empcode: "ALL",
    LastRecord: lastRecord,
  })) as {
    Error?: boolean;
    Msg?: string;
    PunchData?: Array<{ Name?: string | null; Empcode: string; PunchDate: string; ID?: number }>;
    MaxRecord?: string;
  };

  if (payload.Error) {
    throw new TeamOfficeApiError(`TeamOffice reported an error: ${payload.Msg ?? "unknown"}`);
  }

  const punches: TeamOfficePunch[] = (payload.PunchData ?? []).map((p) => ({
    name: p.Name ?? null,
    empcode: p.Empcode,
    punchTime: parsePunchDate(p.PunchDate),
    id: typeof p.ID === "number" ? p.ID : null,
  }));

  return { punches, maxRecord: payload.MaxRecord ?? null };
}

/** API 2 — DownloadPunchDataMCID. Used to backfill employee names for the
 *  device-mapping suggestion screen (DownloadLastPunchData already carries
 *  Name too, so this is a fallback / explicit range query, not the poller). */
export async function downloadPunchDataMCID(
  empcode: string,
  from: Date,
  to: Date,
): Promise<TeamOfficePunch[]> {
  const payload = (await get("DownloadPunchDataMCID", {
    Empcode: empcode,
    FromDate: formatQueryDate(from),
    ToDate: formatQueryDate(to),
  })) as {
    Error?: boolean;
    Msg?: string;
    PunchData?: Array<{ Name?: string | null; Empcode: string; PunchDate: string }>;
  };

  if (payload.Error) {
    throw new TeamOfficeApiError(`TeamOffice reported an error: ${payload.Msg ?? "unknown"}`);
  }

  return (payload.PunchData ?? []).map((p) => ({
    name: p.Name ?? null,
    empcode: p.Empcode,
    punchTime: parsePunchDate(p.PunchDate),
    id: null,
  }));
}

/** API 1 — DownloadPunchData (raw, no Name/MCID). Kept for completeness /
 *  manual diagnostics; not used by the polling cron. */
export async function downloadPunchData(empcode: string, from: Date, to: Date): Promise<TeamOfficePunch[]> {
  const payload = (await get("DownloadPunchData", {
    Empcode: empcode,
    FromDate: formatQueryDate(from),
    ToDate: formatQueryDate(to),
  })) as Array<{ Empcode: string; PunchDate: string }>;

  return (Array.isArray(payload) ? payload : []).map((p) => ({
    name: null,
    empcode: p.Empcode,
    punchTime: parsePunchDate(p.PunchDate),
    id: null,
  }));
}

export type TeamOfficeInOutRow = {
  empcode: string;
  name: string | null;
  inTime: string;
  outTime: string;
  workTime: string;
  status: string;
  dateString: string;
};

/** API 3 — DownloadInOutPunchData. Vendor-computed IN/OUT/status summary per
 *  day; not used by reconciliation (which pairs raw punches itself so it can
 *  apply the WFH/approved-day source-of-truth guard), kept for diagnostics
 *  and completeness against the documented API surface. */
export async function downloadInOutPunchData(
  empcode: string,
  from: Date,
  to: Date,
): Promise<TeamOfficeInOutRow[]> {
  const payload = (await get("DownloadInOutPunchData", {
    Empcode: empcode,
    FromDate: formatQueryDate(from),
    ToDate: formatQueryDate(to),
  })) as {
    Error?: boolean;
    Msg?: string;
    InOutPunchData?: Array<{
      Empcode: string;
      Name?: string | null;
      INTime: string;
      OUTTime: string;
      WorkTime: string;
      Status: string;
      DateString: string;
    }>;
  };

  if (payload.Error) {
    throw new TeamOfficeApiError(`TeamOffice reported an error: ${payload.Msg ?? "unknown"}`);
  }

  return (payload.InOutPunchData ?? []).map((r) => ({
    empcode: r.Empcode,
    name: r.Name ?? null,
    inTime: r.INTime,
    outTime: r.OUTTime,
    workTime: r.WorkTime,
    status: r.Status,
    dateString: r.DateString,
  }));
}
