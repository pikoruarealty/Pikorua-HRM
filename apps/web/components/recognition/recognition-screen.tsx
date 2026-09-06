"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiFetch } from "@/components/_lib/api";
import { formatDate } from "@/lib/format-date";
import { ScoreBreakdown, type ScoreComponents } from "./score-breakdown";

type LeaderboardRow = {
  employeeId: string;
  employeeName: string;
  departmentId: string;
  departmentName: string;
  score: number;
  rank: number;
  isEmployeeOfMonth: boolean;
  // Monthly composite breakdown (Pillar 6). Null on weekly snapshots and on
  // monthly rows computed before Pillar 6 — those show a bare score.
  components: ScoreComponents | null;
  // Whether an Admin has published THIS department's board for this period
  // (2026-09-06) — gates visibility for non-Admin/HR viewers server-side;
  // always true for rows a non-privileged viewer ever receives.
  isPublished: boolean;
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
  const [publishingDeptId, setPublishingDeptId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
    const res = await apiFetch<{
      results: { periodType: string; rowsWritten: number; skippedReason?: string }[];
    }>("/recognition/recompute", {
      method: "POST",
      body: JSON.stringify({ periodType }),
    });
    setRecomputing(false);
    if (res.error) {
      setActionError(`${res.error.code}: ${res.error.message}`);
      return;
    }
    const skipped = res.data?.results.find((r) => r.skippedReason);
    if (skipped?.skippedReason) {
      setActionError(skipped.skippedReason);
    }
    lookup(periodType);
  }

  async function pickWinner(row: LeaderboardRow) {
    if (!result?.periodStart) return;
    if (
      !confirm(
        `Pick ${row.employeeName} as ${periodType === "weekly" ? "Employee of the Week" : "Employee of the Month"} for ${row.departmentName}?`,
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

  // Single department-wide visibility toggle (2026-09-06 redesign) — replaces
  // the old "one Publish button per employee" pattern. This does not pick a
  // winner; it just decides whether the department's employees can see this
  // period's board at all (Admin/HR always can). Winner-picking stays a
  // separate action (pickWinner, above).
  async function toggleDepartmentPublish(departmentId: string, published: boolean) {
    if (!result?.periodStart) return;
    setPublishingDeptId(departmentId);
    setActionError(null);
    const res = await apiFetch("/recognition/leaderboard-publish", {
      method: "POST",
      body: JSON.stringify({ periodType, periodStart: result.periodStart, departmentId, published }),
    });
    setPublishingDeptId(null);
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
          {periodType === "monthly"
            ? "Monthly scores are a 0-100 composite of output, quality, attendance, timeliness and commitments kept — open a score to see the breakdown. "
            : "Weekly scores are raw output only. "}
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
              {(() => {
                const groups: {
                  departmentId: string;
                  departmentName: string;
                  isPublished: boolean;
                  rows: LeaderboardRow[];
                }[] = [];
                for (const r of result.leaderboard) {
                  let group = groups.find((g) => g.departmentId === r.departmentId);
                  if (!group) {
                    group = {
                      departmentId: r.departmentId,
                      departmentName: r.departmentName,
                      isPublished: r.isPublished,
                      rows: [],
                    };
                    groups.push(group);
                  }
                  group.rows.push(r);
                }

                return groups.map((group) => (
                  <div key={group.departmentId} className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold">{group.departmentName}</h3>
                      {isAdmin ? (
                        <Button
                          size="sm"
                          variant={group.isPublished ? "outline" : "default"}
                          onClick={() => toggleDepartmentPublish(group.departmentId, !group.isPublished)}
                          disabled={publishingDeptId === group.departmentId}
                        >
                          {publishingDeptId === group.departmentId
                            ? "Saving…"
                            : group.isPublished
                              ? "Unpublish leaderboard"
                              : "Publish leaderboard"}
                        </Button>
                      ) : (
                        group.isPublished && <Badge variant="outline">Published</Badge>
                      )}
                    </div>
                    <div className="flex flex-col gap-2">
                      {group.rows.map((r) => {
                        const rowId = `${r.departmentId}-${r.employeeId}`;
                        const expanded = expandedId === rowId;
                        return (
                          <div key={rowId} className="rounded border text-sm">
                            <div className="flex items-center justify-between p-3">
                              <span>
                                <strong>#{r.rank}</strong> {r.employeeName}
                              </span>
                              <div className="flex items-center gap-2">
                                {r.components ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-auto px-2 py-1 font-normal text-muted-foreground"
                                    aria-expanded={expanded}
                                    onClick={() => setExpandedId(expanded ? null : rowId)}
                                  >
                                    score {r.score} / 100
                                    <ChevronDown
                                      className={`ml-1 h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
                                    />
                                  </Button>
                                ) : (
                                  <span className="text-muted-foreground">score {r.score}</span>
                                )}
                                {r.isEmployeeOfMonth && (
                                  <Badge>
                                    {periodType === "weekly"
                                      ? "Employee of the Week"
                                      : "Employee of the Month"}
                                  </Badge>
                                )}
                                {isAdmin && !r.isEmployeeOfMonth && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => pickWinner(r)}
                                    disabled={publishingId === r.employeeId}
                                  >
                                    {publishingId === r.employeeId ? "Picking…" : "Pick winner"}
                                  </Button>
                                )}
                              </div>
                            </div>
                            {expanded && r.components && (
                              <div className="border-t bg-muted/30 p-3">
                                <ScoreBreakdown data={r.components} />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ));
              })()}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
