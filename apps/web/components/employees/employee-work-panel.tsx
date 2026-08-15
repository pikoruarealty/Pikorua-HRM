"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/components/_lib/api";
import { formatDate } from "@/lib/format-date";

type Doc = { id: string; docType: string; fileUrl: string; uploadedAt: string };
type LedgerEntry = {
  id: string;
  points: number;
  creditedAt: string;
  workItemId: string;
  workItem: {
    id: string;
    title: string;
    subUnit: { id: string; name: string; workUnit: { id: string; name: string } } | null;
  } | null;
};
type Points = { balance: number; ledger: LedgerEntry[] };
type HistoryRow = {
  id: string;
  title: string;
  periodMonth: number | null;
  periodYear: number | null;
  achievedPct: number | null;
};

// Documents + points + metric growth history for one employee, shown on the
// employee detail page. Each sub-card degrades gracefully if the viewer's role
// can't see that data (the underlying route 403s → sub-card shows nothing).
//
// "Task points" (EmployeePointLedger) only exists for atomic/self-logged tech
// tasks — sales/BD employees work exclusively in metric-mode WorkItems, which
// are scored via call/visit/booking attainment % instead (lib/performance/
// monthly-score.ts), never through this ledger. Showing the points card to a
// metric-department employee would always read 0 and look like nothing is
// being tracked, when the "Metric growth history" card below is the real
// record — so it's hidden for them rather than shown empty.
export function EmployeeWorkPanel({ employeeId, isMetric }: { employeeId: string; isMetric: boolean }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [points, setPoints] = useState<Points | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [docType, setDocType] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const [d, p, h] = await Promise.all([
      apiFetch<Doc[]>(`/employees/${employeeId}/documents`),
      apiFetch<Points>(`/employees/${employeeId}/points`),
      apiFetch<HistoryRow[]>(`/employees/${employeeId}/work-items/history`),
    ]);
    if (d.data) setDocs(d.data);
    if (p.data) setPoints(p.data);
    if (h.data) setHistory(h.data);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file || !docType.trim()) {
      setError("Pick a document type and a file.");
      return;
    }
    const fd = new FormData();
    fd.append("docType", docType.trim());
    fd.append("file", file);
    const res = await apiFetch(`/employees/${employeeId}/documents`, { method: "POST", body: fd });
    if (res.error) {
      setError(`${res.error.code}: ${res.error.message}`);
      return;
    }
    setDocType("");
    setFile(null);
    refresh();
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {docs.length === 0 && <p className="text-sm text-muted-foreground">No documents.</p>}
          {docs.map((d) => (
            <div key={d.id} className="flex items-center justify-between rounded border p-2 text-sm">
              <span>
                <Badge variant="outline">{d.docType}</Badge>{" "}
                <span className="text-muted-foreground">
                  {formatDate(d.uploadedAt)}
                </span>
              </span>
              <span className="flex items-center gap-3">
                <a href={d.fileUrl} className="text-sm underline" target="_blank" rel="noreferrer">
                  View
                </a>
                <a href={`${d.fileUrl}?download=1`} className="text-sm underline" download>
                  Download
                </a>
              </span>
            </div>
          ))}
          <form onSubmit={upload} className="grid gap-2 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label>Document type</Label>
              <Input
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
                placeholder="e.g. offer_letter"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>File</Label>
              <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
            <div className="flex items-end">
              <Button type="submit" size="sm">
                Upload
              </Button>
            </div>
            {error && <p className="text-sm text-destructive sm:col-span-3">{error}</p>}
          </form>
        </CardContent>
      </Card>

      {points && !isMetric && (
        <Card>
          <CardHeader>
            <CardTitle>Task points · balance {points.balance}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {points.ledger.length === 0 && (
              <p className="text-sm text-muted-foreground">No points credited yet.</p>
            )}
            {points.ledger.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-3 rounded border p-2 text-sm">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">
                    {l.workItem?.title ?? "(task deleted)"}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {l.workItem?.subUnit
                      ? `${l.workItem.subUnit.workUnit.name} · ${l.workItem.subUnit.name}`
                      : "—"}
                    {" · "}
                    {formatDate(l.creditedAt)}
                  </span>
                </span>
                <span className="shrink-0 font-medium">+{l.points} pts</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Metric growth history</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {history.map((h) => (
              <div key={h.id} className="flex items-center justify-between rounded border p-2 text-sm">
                <span>
                  {h.title}{" "}
                  <span className="text-muted-foreground">
                    ({h.periodMonth}/{h.periodYear})
                  </span>
                </span>
                <Badge variant="outline">
                  {h.achievedPct == null ? "—" : `${Math.round(h.achievedPct)}%`}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}
