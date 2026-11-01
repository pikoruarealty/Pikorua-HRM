"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { DatePicker } from "@/components/ui/date-picker";
import { EmployeeAvatar } from "@/components/employees/employee-avatar";
import { WorkItemStatusBadge } from "@/components/work/status-badge";
import { RemindButton } from "@/components/notifications/remind-button";
import { formatTime } from "@/lib/format-date";
import { cn } from "@/lib/utils";

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
  inReviewCount: number;
  pointsEarnedToday: number;
  isMetric: boolean;
  items: TaskProgressItem[];
};

type TaskProgress = { date: string; rows: TaskProgressRow[] };

async function getJson(res: Response) {
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data;
}

function fmtTime(iso: string | null) {
  return formatTime(iso);
}

export function TeamTaskProgressPanel({ canRemind = false }: { canRemind?: boolean }) {
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
        <DatePicker
          value={date}
          onChange={(v) => v && setDate(v)}
          className="h-9 w-auto"
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
                {/* Fixed columns from xl up (name | status | progress | points | tasks
                    link | remind), every cell present even when empty, so the rows line
                    up. On a phone: name + remind on the first line, the rest below. */}
                <div
                  className={cn(
                    "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2",
                    canRemind
                      ? "xl:grid-cols-[minmax(0,1fr)_7.5rem_10rem_6.5rem_5.5rem_2.25rem]"
                      : "xl:grid-cols-[minmax(0,1fr)_7.5rem_10rem_6.5rem_5.5rem]",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <EmployeeAvatar photoUrl={r.photoUrl} fullName={r.fullName} size="sm" />
                    <div className="min-w-0">
                      <Link
                        href={`/employees/${r.employeeId}`}
                        className="block truncate text-sm font-medium hover:underline"
                      >
                        {r.fullName}
                      </Link>
                      <div className="truncate text-xs text-muted-foreground">
                        In {fmtTime(r.clockIn)} · Out {fmtTime(r.clockOut)}
                      </div>
                    </div>
                  </div>
                  <div className="col-span-2 flex items-center gap-3 xl:contents">
                    <div className="shrink-0 xl:justify-self-start">
                      <Badge variant={r.clockOut ? "outline" : r.clockIn ? "default" : "outline"} className="whitespace-nowrap">
                        {r.clockOut ? "clocked out" : r.clockIn ? "clocked in" : "not clocked in"}
                      </Badge>
                    </div>
                    <div className="flex min-w-[4rem] flex-1 flex-col gap-1 xl:w-full">
                      <Progress value={pct} />
                      <span className="truncate text-xs text-muted-foreground">
                        {r.completedCount}/{r.plannedCount} tasks
                        {r.inReviewCount > 0 && ` · ${r.inReviewCount} to review`}
                      </span>
                    </div>
                    <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground empty:hidden xl:empty:block xl:text-right">
                      {r.isMetric ? null : (
                        <>
                          +{r.pointsEarnedToday} pts<span className="hidden sm:inline"> today</span>
                        </>
                      )}
                    </span>
                    <span className="shrink-0 empty:hidden xl:empty:block xl:text-right">
                      {r.items.length > 0 && (
                        <button
                          type="button"
                          className="whitespace-nowrap text-xs text-muted-foreground underline"
                          onClick={() => setExpanded((c) => ({ ...c, [r.employeeId]: !isOpen }))}
                        >
                          {isOpen ? "Hide tasks" : "View tasks"}
                        </button>
                      )}
                    </span>
                  </div>
                  {canRemind && (
                    <div className="col-start-2 row-start-1 justify-self-end xl:col-start-auto xl:row-start-auto">
                      <RemindButton
                        endpoint={`/employees/${r.employeeId}/remind-tasks`}
                        label={`Remind ${r.fullName} about their open tasks`}
                      />
                    </div>
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
                          <WorkItemStatusBadge status={i.status} />
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
