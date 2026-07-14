"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "../_lib/api";

type HistoryRow = {
  id: string;
  title: string;
  periodMonth: number;
  periodYear: number;
  targetValue: string;
  currentValue: string;
  achievedPct: number | null;
  status: string;
};

export default function HistoryPage() {
  const [employeeId, setEmployeeId] = useState("");
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await apiFetch<HistoryRow[]>(`/employees/${employeeId}/work-items/history`);
    if (res.error) {
      setError(`${res.error.code}: ${res.error.message}`);
      setRows([]);
      return;
    }
    setRows(res.data ?? []);
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Growth over time (GET /employees/:id/work-items/history)</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={lookup} className="flex items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <Label>Employee ID (UUID — Sales/BD metric performer)</Label>
              <Input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required />
            </div>
            <Button type="submit">Look up</Button>
          </form>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <Card>
          <CardContent className="flex flex-col gap-2 pt-6">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded border p-3 text-sm">
                <span>{r.title} — {r.periodMonth}/{r.periodYear}</span>
                <span>{r.currentValue}/{r.targetValue} ({r.achievedPct ?? "—"}%)</span>
                <Badge variant="outline">{r.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
