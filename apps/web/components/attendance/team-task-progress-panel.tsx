"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { EmployeeAvatar } from "@/components/employees/employee-avatar";

// Lead/Admin "what is everyone doing right now" live view (companion to the
// employee-facing planning-screen.tsx EOD card): every scoped employee's
// clock status + today's task plan + live completion progress, in one call.
// Data from GET /api/v1/attendance/task-progress (Admin/HR: everyone; Lead:
// every team they lead + self).

type TaskProgressItem = {
  workItemId: string;
  title: string;
  status: string;
  projectName: string;
  subUnitName: string;
  completedToday: boolean;
};

type TaskProgressRow = {
  employeeId: string;
  fullName: string;
  photoUrl: string | null;
  clockIn: string | null;
  clockOut: string | null;
  plannedCount: number;
  completedCount: number;
  pointsEarnedToday: number;
  items: TaskProgressItem[];
};

type TaskProgress = { date: string; rows: TaskProgressRow[] };

async function getJson(res: Response) {
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data;
}

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function TeamTaskProgressPanel() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<TaskProgress | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getJson(await fetch(`/api/v1/attendance/task-progress?date=${date}`)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load team task progress.");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle>Team task progress</CardTitle>
        <input
          type="date"
          className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {loading && !data ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : data && data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No employees in scope.</p>
        ) : (
          data?.rows.map((r) => {
            const pct = r.plannedCount > 0 ? (r.completedCount / r.plannedCount) * 100 : 0;
            const isOpen = !!expanded[r.employeeId];
            return (
              <div key={r.employeeId} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <EmployeeAvatar photoUrl={r.photoUrl} fullName={r.fullName} size="sm" />
                  <div className="min-w-[10rem] flex-1">
                    <Link href={`/employees/${r.employeeId}`} className="text-sm font-medium hover:underline">
                      {r.fullName}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      In {fmtTime(r.clockIn)} · Out {fmtTime(r.clockOut)}
                    </div>
                  </div>
                  <Badge variant={r.clockOut ? "outline" : r.clockIn ? "default" : "outline"}>
                    {r.clockOut ? "clocked out" : r.clockIn ? "clocked in" : "not clocked in"}
                  </Badge>
                  <div className="flex w-40 flex-col gap-1">
                    <Progress value={pct} />
                    <span className="text-xs text-muted-foreground">
                      {r.completedCount}/{r.plannedCount} tasks
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">+{r.pointsEarnedToday} pts today</span>
                  {r.items.length > 0 && (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline"
                      onClick={() => setExpanded((c) => ({ ...c, [r.employeeId]: !isOpen }))}
                    >
                      {isOpen ? "Hide tasks" : "View tasks"}
                    </button>
                  )}
                </div>
                {isOpen && (
                  <div className="mt-3 flex flex-col gap-2 border-t pt-3">
                    {r.items.map((i) => (
                      <div
                        key={i.workItemId}
                        className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm"
                      >
                        <span>
                          {i.title}{" "}
                          <span className="text-muted-foreground">
                            ({i.projectName} · {i.subUnitName})
                          </span>
                        </span>
                        <div className="flex items-center gap-2">
                          {i.completedToday && <Badge>done today</Badge>}
                          <Badge variant="outline">{i.status}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
