"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiFetch } from "@/components/_lib/api";
import { formatDate } from "@/lib/format-date";

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

export function RecognitionScreen() {
  const [periodType, setPeriodType] = useState<"weekly" | "monthly">("monthly");
  const [result, setResult] = useState<RecognitionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function lookup(pt: "weekly" | "monthly") {
    setError(null);
    const res = await apiFetch<RecognitionResponse>(`/recognition?period_type=${pt}`);
    if (res.error) {
      setError(`${res.error.code}: ${res.error.message}`);
      setResult(null);
      return;
    }
    setResult(res.data ?? null);
  }

  useEffect(() => {
    lookup(periodType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodType]);

  useEffect(() => {
    apiFetch<{ role: string }>("/auth/me").then((res) => {
      if (res.data) setIsAdmin(res.data.role === "admin");
    });
  }, []);

  async function recompute() {
    setRecomputing(true);
    setActionError(null);
    const res = await apiFetch("/recognition/recompute", {
      method: "POST",
      body: JSON.stringify({ periodType }),
    });
    setRecomputing(false);
    if (res.error) {
      setActionError(`${res.error.code}: ${res.error.message}`);
      return;
    }
    lookup(periodType);
  }

  async function publish(row: LeaderboardRow) {
    if (!result?.periodStart) return;
    if (
      !confirm(
        `Publish ${row.employeeName} as ${periodType === "weekly" ? "Employee of the Week" : "Employee of the Month"} for ${row.departmentName}?`,
      )
    ) {
      return;
    }
    setPublishingId(row.employeeId);
    setActionError(null);
    const res = await apiFetch("/recognition/publish", {
      method: "POST",
      body: JSON.stringify({
        periodType,
        periodStart: result.periodStart,
        departmentId: row.departmentId,
        employeeId: row.employeeId,
      }),
    });
    setPublishingId(null);
    if (res.error) {
      setActionError(`${res.error.code}: ${res.error.message}`);
      return;
    }
    lookup(periodType);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Recognition</h1>
        <p className="text-sm text-muted-foreground">
          Weekly / monthly leaderboard per department.{" "}
          {isAdmin
            ? "Employee of the Week/Month is now an admin pick — publish a winner from the leaderboard below."
            : "Employee of the Week/Month is published by an admin."}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Leaderboard</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <Label>Period</Label>
              <Select
                value={periodType}
                onValueChange={(v) => setPeriodType(v as "weekly" | "monthly")}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {isAdmin && (
              <Button size="sm" variant="outline" onClick={recompute} disabled={recomputing}>
                {recomputing ? "Recomputing…" : "Recompute leaderboard"}
              </Button>
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {actionError && <p className="text-sm text-destructive">{actionError}</p>}
          {result && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                {result.periodStart
                  ? `Period starting ${formatDate(result.periodStart)}`
                  : "No snapshot computed yet for this period type."}
              </p>
              {result.leaderboard.length === 0 && (
                <p className="text-sm text-muted-foreground">No snapshot yet.</p>
              )}
              {result.leaderboard.map((r) => (
                <div
                  key={`${r.departmentId}-${r.employeeId}`}
                  className="flex items-center justify-between rounded border p-3 text-sm"
                >
                  <span>
                    <strong>#{r.rank}</strong> {r.employeeName}{" "}
                    <span className="text-muted-foreground">· {r.departmentName}</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">score {r.score}</span>
                    {r.isEmployeeOfMonth && (
                      <Badge>{periodType === "weekly" ? "Employee of the Week" : "Employee of the Month"}</Badge>
                    )}
                    {isAdmin && !r.isEmployeeOfMonth && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => publish(r)}
                        disabled={publishingId === r.employeeId}
                      >
                        {publishingId === r.employeeId ? "Publishing…" : "Publish"}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
