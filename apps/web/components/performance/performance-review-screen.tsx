"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiFetch } from "@/components/_lib/api";
import { EmployeeAvatar } from "@/components/employees/employee-avatar";
import { RATING_LABELS, RATING_MAX, RATING_MIN, currentPeriod } from "@/lib/performance/review";

// The Lead's monthly review sheet (Pillar 3, 2026-08-08).
//
// Deliberately a single screen with no wizard: pick a month, and for each of
// your people click a number and (optionally) type a line. Saving one row is
// one request; nothing is batched, so a half-finished sheet is still half
// saved. This whole surface is Lead/Admin-only — nothing here is employee-facing.

type QueueRow = {
  id: string;
  fullName: string;
  role: string;
  teamName: string | null;
  photoUrl: string | null;
  joinedAfterPeriod: boolean;
  review: { id: string; rating: number; note: string | null; updatedAt: string } | null;
};

type Queue = {
  period: { periodYear: number; periodMonth: number; label: string };
  summary: { reviewable: number; reviewed: number; pending: number };
  employees: QueueRow[];
};

const RATINGS = Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, i) => RATING_MIN + i);

/** The last 12 months up to and including the current one, newest first. */
function selectablePeriods(): { value: string; label: string }[] {
  const now = currentPeriod();
  const out: { value: string; label: string }[] = [];
  let { periodYear: y, periodMonth: m } = now;
  for (let i = 0; i < 12; i++) {
    const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    out.push({ value: `${y}-${m}`, label });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

function ReviewRow({
  row,
  period,
  onSaved,
}: {
  row: QueueRow;
  period: Queue["period"];
  onSaved: () => void;
}) {
  const [rating, setRating] = useState<number | null>(row.review?.rating ?? null);
  const [note, setNote] = useState(row.review?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  // A month switch remounts nothing (same employee ids), so re-seed local
  // state whenever the underlying review changes.
  useEffect(() => {
    setRating(row.review?.rating ?? null);
    setNote(row.review?.note ?? "");
    setError(null);
    setSaved(false);
  }, [row.review?.id, row.review?.rating, row.review?.note, period.periodYear, period.periodMonth]);

  const dirty =
    rating !== (row.review?.rating ?? null) || note.trim() !== (row.review?.note ?? "");

  async function save() {
    if (rating === null) return setError("Pick a rating first.");
    setError(null);
    setBusy(true);
    const res = row.review
      ? await apiFetch(`/performance-reviews/${row.review.id}`, {
          method: "PATCH",
          body: JSON.stringify({ rating, note: note.trim() || null }),
        })
      : await apiFetch(`/employees/${row.id}/performance-review`, {
          method: "POST",
          body: JSON.stringify({
            periodYear: period.periodYear,
            periodMonth: period.periodMonth,
            rating,
            ...(note.trim() ? { note: note.trim() } : {}),
          }),
        });
    setBusy(false);
    if (res.error) return setError(`${res.error.code}: ${res.error.message}`);
    setSaved(true);
    onSaved();
  }

  if (row.joinedAfterPeriod) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-3 opacity-70">
        <EmployeeAvatar photoUrl={row.photoUrl} fullName={row.fullName} size="sm" />
        <div className="flex-1">
          <p className="text-sm font-medium">{row.fullName}</p>
          <p className="text-xs text-muted-foreground">
            Joined after {period.label} — nothing to review.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-start gap-3">
        <EmployeeAvatar photoUrl={row.photoUrl} fullName={row.fullName} size="sm" />
        <div className="min-w-[12rem] flex-1">
          <p className="text-sm font-medium">
            <Link href={`/employees/${row.id}`} className="hover:underline">
              {row.fullName}
            </Link>
          </p>
          <p className="text-xs text-muted-foreground">
            {row.role.replace(/_/g, " ")}
            {row.teamName && ` · ${row.teamName}`}
          </p>
        </div>
        {row.review ? (
          <Badge variant="success">Reviewed</Badge>
        ) : (
          <Badge variant="muted">Not yet reviewed</Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {RATINGS.map((r) => (
          <Button
            key={r}
            type="button"
            size="sm"
            variant={rating === r ? "default" : "outline"}
            className="w-9"
            aria-label={`${r} — ${RATING_LABELS[r]}`}
            aria-pressed={rating === r}
            onClick={() => {
              setRating(r);
              setSaved(false);
            }}
          >
            {r}
          </Button>
        ))}
        <span className="ml-2 text-xs text-muted-foreground">
          {rating === null ? "1 = well below, 5 = outstanding" : RATING_LABELS[rating]}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Textarea
          className="min-w-[16rem] flex-1"
          rows={1}
          aria-label={`Note for ${row.fullName}`}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setSaved(false);
          }}
          placeholder="Optional — one line on what drove this month's rating."
        />
        <Button size="sm" onClick={save} disabled={busy || (!dirty && row.review !== null)}>
          {row.review ? "Update" : "Save"}
        </Button>
      </div>
      {saved && !dirty && <p className="text-xs text-green-600">Saved.</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

export function PerformanceReviewScreen() {
  const now = currentPeriod();
  const [periodKey, setPeriodKey] = useState(`${now.periodYear}-${now.periodMonth}`);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const periods = selectablePeriods();

  const refresh = useCallback(async () => {
    const [year, month] = periodKey.split("-");
    const res = await apiFetch<Queue>(`/performance-reviews/queue?year=${year}&month=${month}`);
    if (res.error) {
      setError(`${res.error.code}: ${res.error.message}`);
      setQueue(null);
    } else {
      setError(null);
      setQueue(res.data);
    }
  }, [periodKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Monthly review</h1>
        <p className="text-sm text-muted-foreground">
          One rating a month for each of your people — your read on how the month actually went,
          alongside the numbers the system counts on its own. Nothing here is shown to anyone
          outside you, the employee, and Admin/HR.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={periodKey} onValueChange={setPeriodKey}>
          <SelectTrigger className="w-[12rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {periods.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {queue && (
          <p className="text-sm text-muted-foreground">
            {queue.summary.reviewed} of {queue.summary.reviewable} reviewed
            {queue.summary.pending > 0 && ` · ${queue.summary.pending} left`}
          </p>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {queue ? queue.period.label : "Loading…"}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {queue === null && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
          {queue?.employees.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No one to review — you don&apos;t lead a team with members yet.
            </p>
          )}
          {queue?.employees.map((row) => (
            <ReviewRow
              key={row.id}
              row={row}
              period={queue.period}
              onSaved={refresh}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
