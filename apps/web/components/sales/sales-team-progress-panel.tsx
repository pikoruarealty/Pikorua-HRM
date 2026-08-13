"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { DatePicker } from "@/components/ui/date-picker";
import { cn } from "@/lib/utils";

// Pillar 5 (2026-08-10) — the Sales Lead / Admin live view, companion to
// TeamTaskProgressPanel on the Tech side. Data from
// GET /api/v1/sales/team-progress.
//
// Two things this deliberately shows that a naive dashboard would hide:
//
//  - Calls are split "N from CRM + M offline", never one blended number. The
//    offline part is Lead-approved, and showing it separately is what keeps it
//    honest rather than a quiet top-up.
//  - Monthly targets are shown against a PACED target, with the paced figure
//    spelled out, so a rep is never shown as behind on their weekly off or
//    while on approved leave.

type SalesRow = {
  employeeId: string;
  fullName: string;
  teamName: string | null;
  offToday: boolean;
  calls: { crm: number; offline: number; total: number; target: number; pct: number | null };
  siteVisits: { total: number; monthTarget: number; pacedTarget: number | null; pct: number | null };
  bookings: { total: number; monthTarget: number; pacedTarget: number | null; pct: number | null };
  expectedDaysElapsed: number;
  expectedDaysInMonth: number;
  pendingClaims: number;
};

type SalesProgress = {
  date: string;
  month: number;
  year: number;
  rows: SalesRow[];
  totals: {
    reps: number;
    callsToday: number;
    callTargetToday: number;
    siteVisitsMonth: number;
    siteVisitTargetMonth: number;
    bookingsMonth: number;
    bookingTargetMonth: number;
    unmatchedCrmRows: number;
  };
};

async function getJson(res: Response) {
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data;
}

function pctValue(pct: number | null): number {
  return pct === null ? 0 : Math.min(100, Math.max(0, pct));
}

/** A paced target is a fraction of a whole unit — "1.6 bookings so far" is the
 *  honest statement, and rounding it to 2 would show a rep as behind when they
 *  are not. */
function fmtPaced(n: number | null): string {
  if (n === null) return "—";
  return n.toFixed(1).replace(/\.0$/, "");
}

function MetricCell({
  label,
  value,
  target,
  pct,
  hint,
}: {
  label: string;
  value: number;
  target: string;
  pct: number | null;
  hint?: string;
}) {
  return (
    <div className="flex w-36 flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Progress value={pctValue(pct)} />
      <span className="text-xs">
        <span className="font-medium">{value}</span>
        <span className="text-muted-foreground"> / {target}</span>
        {pct !== null && <span className="text-muted-foreground"> · {Math.round(pct)}%</span>}
      </span>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

export function SalesTeamProgressPanel({ canSync }: { canSync: boolean }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<SalesProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getJson(await fetch(`/api/v1/sales/team-progress?date=${date}`)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sales progress.");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  // Pulls the CRM's activity feed right now instead of waiting for the hourly
  // job, then reloads this panel off the freshly-synced numbers.
  async function syncNow() {
    setSyncing(true);
    setSyncNotice(null);
    setError(null);
    try {
      const result = await getJson(
        await fetch("/api/v1/sales/crm-sync", { method: "POST" }),
      );
      if (result.skipped === "not-configured") {
        setSyncNotice("CRM is not configured on the server — nothing to sync.");
      } else {
        setSyncNotice(
          `Synced ${result.rows} rows (${result.matched} matched, ${result.unmatched} unmatched).`,
        );
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to sync CRM activity.");
    } finally {
      setSyncing(false);
    }
  }

  const t = data?.totals;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle>Sales team progress</CardTitle>
        <div className="flex items-center gap-2">
          <DatePicker value={date} onChange={(v) => v && setDate(v)} className="h-9 w-auto" />
          {canSync && (
            <Button
              size="icon"
              variant="ghost"
              className="size-9"
              onClick={syncNow}
              disabled={syncing}
              aria-label="Sync CRM activity now"
              title="Fetch the latest CRM activity now"
            >
              <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {syncNotice && <p className="text-sm text-muted-foreground">{syncNotice}</p>}

        {t && t.reps > 0 && (
          <div className="flex flex-wrap gap-4 rounded-lg border bg-muted/40 p-3 text-sm">
            <span>
              <span className="font-medium">{t.callsToday}</span>
              <span className="text-muted-foreground"> / {t.callTargetToday} calls today</span>
            </span>
            <span>
              <span className="font-medium">{t.siteVisitsMonth}</span>
              <span className="text-muted-foreground"> / {t.siteVisitTargetMonth} site visits this month</span>
            </span>
            <span>
              <span className="font-medium">{t.bookingsMonth}</span>
              <span className="text-muted-foreground"> / {t.bookingTargetMonth} bookings this month</span>
            </span>
            {t.unmatchedCrmRows > 0 && (
              <Badge variant="destructive">
                {t.unmatchedCrmRows} unmatched CRM {t.unmatchedCrmRows === 1 ? "row" : "rows"}
              </Badge>
            )}
          </div>
        )}

        {loading && !data ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : data && data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sales employees in scope.</p>
        ) : (
          data?.rows.map((r) => (
            <div key={r.employeeId} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-4">
                <div className="min-w-[10rem] flex-1">
                  <Link
                    href={`/employees/${r.employeeId}`}
                    className="text-sm font-medium hover:underline"
                  >
                    {r.fullName}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {r.teamName ?? "No team"} · {r.expectedDaysElapsed}/{r.expectedDaysInMonth} working
                    days elapsed
                  </div>
                </div>

                {r.offToday && <Badge variant="outline">weekly off</Badge>}
                {r.pendingClaims > 0 && (
                  <Badge variant="secondary">
                    {r.pendingClaims} offline {r.pendingClaims === 1 ? "claim" : "claims"} pending
                  </Badge>
                )}

                <MetricCell
                  label="Calls today"
                  value={r.calls.total}
                  target={r.offToday ? "off" : String(r.calls.target)}
                  pct={r.calls.pct}
                  hint={
                    r.calls.offline > 0
                      ? `${r.calls.crm} CRM + ${r.calls.offline} offline`
                      : undefined
                  }
                />
                <MetricCell
                  label="Site visits (month)"
                  value={r.siteVisits.total}
                  target={fmtPaced(r.siteVisits.pacedTarget)}
                  pct={r.siteVisits.pct}
                  hint={`${r.siteVisits.monthTarget} by month end`}
                />
                <MetricCell
                  label="Bookings (month)"
                  value={r.bookings.total}
                  target={fmtPaced(r.bookings.pacedTarget)}
                  pct={r.bookings.pct}
                  hint={`${r.bookings.monthTarget} by month end`}
                />
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
