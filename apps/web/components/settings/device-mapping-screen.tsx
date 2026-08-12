"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format-date";
import { apiFetch } from "@/components/_lib/api";

type Suggestion = { employeeId: string; fullName: string; similarity: number };

type UnmatchedRow = {
  deviceUid: string;
  name: string | null;
  punchCount: number;
  firstSeen: string | null;
  lastSeen: string | null;
  suggestions: Suggestion[];
};

export function DeviceMappingScreen() {
  const [rows, setRows] = useState<UnmatchedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await apiFetch<{ unmatched: UnmatchedRow[] }>("/device-mapping/unmatched");
    if (res.error) {
      setError(`${res.error.code}: ${res.error.message}`);
      setLoading(false);
      return;
    }
    setRows(res.data?.unmatched ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const confirm = useCallback(
    async (deviceUid: string, employeeId: string) => {
      setConfirming(deviceUid);
      setError(null);
      const res = await apiFetch("/device-mapping/confirm", {
        method: "POST",
        body: JSON.stringify({ deviceUid, employeeId }),
      });
      setConfirming(null);
      if (res.error) {
        setError(`${res.error.code}: ${res.error.message}`);
        return;
      }
      await load();
    },
    [load],
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Device Mapping</h1>
        <p className="text-sm text-muted-foreground">
          Biometric Empcodes seen on the TeamOffice device that don&apos;t map to an employee yet.
          Confirm a match to link them — nothing links automatically. Admin only.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Unmatched Empcodes</CardTitle>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!loading && rows.length === 0 && !error && (
            <p className="text-sm text-muted-foreground">
              No unmatched device punches — every recent Empcode is already linked.
            </p>
          )}
          {rows.map((row) => (
            <div key={row.deviceUid} className="rounded border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">Empcode {row.deviceUid}</Badge>
                {row.name && <span className="font-medium">{row.name}</span>}
                <span className="text-xs text-muted-foreground">{row.punchCount} unreconciled punches</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {row.firstSeen ? formatDateTime(row.firstSeen) : "—"} →{" "}
                  {row.lastSeen ? formatDateTime(row.lastSeen) : "—"}
                </span>
              </div>
              {row.suggestions.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  No confident name match — pick manually once employee search is available here.
                </p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {row.suggestions.map((s) => (
                    <Button
                      key={s.employeeId}
                      size="sm"
                      variant="secondary"
                      disabled={confirming === row.deviceUid}
                      onClick={() => confirm(row.deviceUid, s.employeeId)}
                    >
                      Link to {s.fullName} ({Math.round(s.similarity * 100)}%)
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
