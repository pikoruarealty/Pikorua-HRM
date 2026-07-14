"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "../_lib/api";

type LeaderboardRow = {
  employeeId: string;
  employeeName: string;
  departmentId: string;
  departmentName: string;
  score: number;
  rank: number;
  isEmployeeOfMonth: boolean;
};
type RecognitionResponse = {
  periodType: "weekly" | "monthly";
  periodStart: string | null;
  leaderboard: LeaderboardRow[];
};

export default function RecognitionPage() {
  const [periodType, setPeriodType] = useState<"weekly" | "monthly">("monthly");
  const [result, setResult] = useState<RecognitionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await apiFetch<RecognitionResponse>(`/recognition?period_type=${periodType}`);
    if (res.error) {
      setError(`${res.error.code}: ${res.error.message}`);
      setResult(null);
      return;
    }
    setResult(res.data ?? null);
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Recognition leaderboard (GET /recognition)</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={lookup} className="flex items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <Label>Period</Label>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={periodType}
                onChange={(e) => setPeriodType(e.target.value as "weekly" | "monthly")}
              >
                <option value="monthly">monthly</option>
                <option value="weekly">weekly</option>
              </select>
            </div>
            <Button type="submit">Look up</Button>
          </form>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          <p className="mt-2 text-xs text-muted-foreground">
            Uses the most recently computed snapshot for this period type. Snapshots are only
            populated after the cron job runs — see progress.md / TRACK_B_TASKLIST 3.1 for how to
            trigger `POST /cron/recognition-snapshot` (CRON_SECRET-gated, not triggerable from this UI).
          </p>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>
              Results {result.periodStart ? `— period starting ${new Date(result.periodStart).toLocaleDateString()}` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {result.leaderboard.length === 0 && (
              <p className="text-sm text-muted-foreground">No snapshot yet for this period type.</p>
            )}
            {result.leaderboard.map((r) => (
              <div key={`${r.departmentId}-${r.employeeId}`} className="flex items-center justify-between rounded border p-3 text-sm">
                <span>
                  #{r.rank} {r.employeeName} — {r.departmentName}
                </span>
                <div className="flex items-center gap-2">
                  <span>score {r.score}</span>
                  {r.isEmployeeOfMonth && <Badge>Employee of the Month</Badge>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
