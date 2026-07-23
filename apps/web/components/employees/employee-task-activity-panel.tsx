"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiFetch } from "@/components/_lib/api";

// Task activity history for one employee — which tasks they worked on, which
// project/sub-unit each belongs to, when assigned, when completed — over a
// period, for the Lead/Admin "how has this person been doing" view + self.
// Data from GET /api/v1/employees/:id/task-activity.

type Period = "daily" | "weekly" | "monthly" | "total";

type ActivityTask = {
  workItemId: string;
  title: string;
  projectName: string;
  subUnitName: string;
  mode: string;
  status: string;
  taskPoints: number | null;
  assignedAt: string;
  completedAt: string | null;
  daysSelectedInPeriod: number;
  pointsEarnedInPeriod: number;
};

type ActivitySummary = {
  period: Period;
  from: string;
  to: string;
  tasksTouched: number;
  tasksCompletedInPeriod: number;
  pointsEarnedInPeriod: number;
  daysActiveInPeriod: number;
};

type Activity = { summary: ActivitySummary; tasks: ActivityTask[] };

const PERIOD_LABELS: Record<Period, string> = {
  daily: "Today",
  weekly: "This week",
  monthly: "This month",
  total: "All time",
};

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

export function EmployeeTaskActivityPanel({ employeeId }: { employeeId: string }) {
  const [period, setPeriod] = useState<Period>("weekly");
  const [activity, setActivity] = useState<Activity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await apiFetch<Activity>(`/employees/${employeeId}/task-activity?period=${period}`);
    if (res.error) {
      setError(res.error.message);
    } else {
      setActivity(res.data);
    }
    setLoading(false);
  }, [employeeId, period]);

  useEffect(() => {
    load();
  }, [load]);

  const s = activity?.summary;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle>Task activity</CardTitle>
        <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <SelectTrigger className="h-9 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
              <SelectItem key={p} value={p}>
                {PERIOD_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {loading && !activity ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : activity ? (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">Tasks touched</dt>
                <dd className="text-2xl font-bold tabular-nums">{s!.tasksTouched}</dd>
              </div>
              <div className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">Completed</dt>
                <dd className="text-2xl font-bold tabular-nums">{s!.tasksCompletedInPeriod}</dd>
              </div>
              <div className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">Points earned</dt>
                <dd className="text-2xl font-bold tabular-nums">{s!.pointsEarnedInPeriod}</dd>
              </div>
              <div className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">Active days</dt>
                <dd className="text-2xl font-bold tabular-nums">{s!.daysActiveInPeriod}</dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              {PERIOD_LABELS[s!.period]} · {s!.from} to {s!.to}
            </p>
            {activity.tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No task activity in this period.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Task</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Points</TableHead>
                    <TableHead>Assigned</TableHead>
                    <TableHead>Completed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activity.tasks.map((t) => (
                    <TableRow key={t.workItemId}>
                      <TableCell>
                        <div className="text-sm">{t.projectName}</div>
                        <div className="text-xs text-muted-foreground">{t.subUnitName}</div>
                      </TableCell>
                      <TableCell>{t.title}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{t.status}</Badge>
                      </TableCell>
                      <TableCell>{t.pointsEarnedInPeriod > 0 ? `+${t.pointsEarnedInPeriod}` : "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{fmtDate(t.assignedAt)}</TableCell>
                      <TableCell className="text-muted-foreground">{fmtDate(t.completedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
