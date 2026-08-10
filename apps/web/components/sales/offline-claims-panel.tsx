"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { formatDate } from "@/lib/format-date";

// Offline call claims UI (2026-08-10) — the human half of "rep proposes, Lead
// approves". A rep who worked a raw Excel list files what the CRM never saw;
// their own claim is visibly worth nothing until a Lead approves it, which is
// stated on the row rather than left implicit.
//
// The reviewer's controls only render for claims this viewer may act on. The
// server refuses self-approval outright (lib/sales/authority.ts), so hiding the
// buttons on your own claim here is presentation, not the enforcement.

type Claim = {
  id: string;
  employeeId: string;
  date: string;
  calls: number;
  note: string;
  status: "pending" | "approved" | "rejected";
  reviewNote: string | null;
  reviewedAt: string | null;
  employee: { id: string; fullName: string };
  reviewer: { id: string; fullName: string } | null;
};

const STATUS_VARIANT: Record<Claim["status"], "secondary" | "default" | "destructive"> = {
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
};

async function getJson(res: Response) {
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function OfflineClaimsPanel({
  employeeId,
  canReview,
  canClaim,
}: {
  /** The viewer's own employee id — used to hide review controls on their own
   *  claims and to label a row as theirs. Null for an account with no employee
   *  record (which also cannot file). */
  employeeId: string | null;
  canReview: boolean;
  /** Whether this viewer files claims of their own (sales roles). Admin/HR
   *  review the queue without a form. */
  canClaim: boolean;
}) {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [date, setDate] = useState(todayStr);
  const [calls, setCalls] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setClaims(await getJson(await fetch("/api/v1/sales/offline-claims")));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load claims.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await getJson(
        await fetch("/api/v1/sales/offline-claims", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date, calls: Number(calls), note: note.trim() }),
        }),
      );
      setCalls("");
      setNote("");
      setDate(todayStr());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to file claim.");
    } finally {
      setSubmitting(false);
    }
  }

  async function review(claim: Claim, action: "approve" | "reject") {
    // A decline must carry a reason — the API enforces it, so ask here rather
    // than let the request bounce.
    let reviewNote: string | null = null;
    if (action === "reject") {
      reviewNote = window.prompt("Why are these calls not being counted?");
      if (!reviewNote || !reviewNote.trim()) return;
    }
    setBusyId(claim.id);
    setError(null);
    try {
      await getJson(
        await fetch(`/api/v1/sales/offline-claims/${claim.id}/review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...(reviewNote ? { note: reviewNote.trim() } : {}) }),
        }),
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to review claim.");
    } finally {
      setBusyId(null);
    }
  }

  const pending = claims.filter((c) => c.status === "pending");

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle>Offline calls</CardTitle>
        {canReview && pending.length > 0 && (
          <Badge variant="secondary">{pending.length} awaiting review</Badge>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Calls made from an Excel list never reach the CRM. They count towards a rep&apos;s daily
          target only once their lead approves the claim.
        </p>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {employeeId && canClaim && (
          <form onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="claim-date">Date</Label>
              <DatePicker
                id="claim-date"
                value={date}
                onChange={(v) => v && setDate(v)}
                min={new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10)}
                max={todayStr()}
                className="h-9 w-auto"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="claim-calls">Calls</Label>
              <Input
                id="claim-calls"
                type="number"
                min={1}
                max={500}
                required
                value={calls}
                onChange={(e) => setCalls(e.target.value)}
                className="w-28"
              />
            </div>
            <div className="flex min-w-[16rem] flex-1 flex-col gap-1">
              <Label htmlFor="claim-note">What were these calls?</Label>
              <Textarea
                id="claim-note"
                required
                minLength={3}
                rows={1}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. cold-call list from the Baner site campaign"
              />
            </div>
            <Button type="submit" disabled={submitting || !calls || note.trim().length < 3}>
              {submitting ? "Filing…" : "File claim"}
            </Button>
          </form>
        )}

        {loading && claims.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : claims.length === 0 ? (
          <p className="text-sm text-muted-foreground">No offline call claims yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {claims.map((c) => {
              const mine = c.employeeId === employeeId;
              const actionable = canReview && !mine && c.status === "pending";
              return (
                <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                  <div className="min-w-[12rem] flex-1">
                    <div className="text-sm font-medium">
                      {mine ? "You" : c.employee.fullName} · {c.calls} calls
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(c.date)} — {c.note}
                    </div>
                    {c.reviewNote && (
                      <div className="text-xs text-muted-foreground">
                        {c.reviewer?.fullName ?? "Reviewer"}: {c.reviewNote}
                      </div>
                    )}
                  </div>
                  <Badge variant={STATUS_VARIANT[c.status]}>{c.status}</Badge>
                  {actionable && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={busyId === c.id}
                        onClick={() => review(c, "approve")}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === c.id}
                        onClick={() => review(c, "reject")}
                      >
                        Decline
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
