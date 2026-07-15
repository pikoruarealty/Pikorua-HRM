"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/components/_lib/api";

type Doc = { id: string; docType: string; fileUrl: string; uploadedAt: string };
type LedgerEntry = { id: string; points: number; creditedAt: string; workItemId: string };
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
export function EmployeeWorkPanel({ employeeId }: { employeeId: string }) {
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
                  {new Date(d.uploadedAt).toLocaleDateString()}
                </span>
              </span>
              <a href={d.fileUrl} className="text-sm underline" target="_blank" rel="noreferrer">
                Download
              </a>
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

      {points && (
        <Card>
          <CardHeader>
            <CardTitle>Task points · balance {points.balance}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {points.ledger.length === 0 && (
              <p className="text-sm text-muted-foreground">No points credited yet.</p>
            )}
            {points.ledger.map((l) => (
              <div key={l.id} className="flex items-center justify-between rounded border p-2 text-sm">
                <span className="text-muted-foreground">
                  {new Date(l.creditedAt).toLocaleDateString()}
                </span>
                <span>+{l.points} pts</span>
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
