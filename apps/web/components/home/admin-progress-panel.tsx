"use client";

import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/components/_lib/api";

// Track A (owner request, 2026-08-07). Admin dashboard progress charts —
// replaces low-value "Pending approvals"/"Draft payslips" tiles with an
// actual view of company task-completion, reusing data the system already
// computes (GET /attendance/task-progress + the new /trend sibling route).
//
// "Today's task completion" redesign (2026-08-08, owner feedback): the
// original side-by-side Completed/Planned bar chart put "Planned" at a fixed
// max width regardless of its actual size, so a 0/1 day looked the same
// scale as a 2/10 day — the chart couldn't show whether today was a busy or
// quiet day, only the ratio. Replaced with a single overlaid progress bar:
// the light "planned" track's own width is scaled against the loudest
// planned-count seen in the last 7 days (today included), so a low-volume
// day renders as a visibly short bar and a high-volume day as a long one —
// then the solid "completed" fill inside that track shows today's actual
// progress toward it. One bar, two things it's actually telling you.

type TaskProgressRow = { employeeId: string; plannedCount: number; completedCount: number };
type TrendPoint = { date: string; planned: number; completed: number };

// Custom recharts tooltip (owner feedback, 2026-08-08): the library's default
// tooltip renders an unstyled dark box with raw lowercase dataKey names
// ("completed : 0") that clashes with the app's theme. This mirrors the
// shadcn popover look (rounded card, theme-aware colors) and title-cases the
// series names via SERIES_LABEL.
const SERIES_LABEL: Record<string, string> = { planned: "Planned", completed: "Completed" };

function TrendTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { dataKey?: string | number; value?: number | string; color?: string }[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium text-popover-foreground">{label}</div>
      <div className="flex flex-col gap-1">
        {payload.map((p) => (
          <div key={String(p.dataKey)} className="flex items-center gap-2">
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
            <span className="text-muted-foreground">{SERIES_LABEL[String(p.dataKey)] ?? p.dataKey}</span>
            <span className="ml-auto font-medium tabular-nums text-popover-foreground">{p.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AdminProgressPanel() {
  const [today, setToday] = useState<TaskProgressRow[] | null>(null);
  const [trend, setTrend] = useState<TrendPoint[] | null>(null);

  useEffect(() => {
    apiFetch<{ date: string; rows: TaskProgressRow[] }>("/attendance/task-progress").then((r) =>
      setToday(r.data?.rows ?? []),
    );
    apiFetch<{ trend: TrendPoint[] }>("/attendance/task-progress/trend").then((r) =>
      setTrend(r.data?.trend ?? []),
    );
  }, []);

  const plannedToday = today?.reduce((s, r) => s + r.plannedCount, 0) ?? 0;
  const completedToday = today?.reduce((s, r) => s + r.completedCount, 0) ?? 0;
  const notStarted = today?.filter((r) => r.plannedCount > 0 && r.completedCount === 0).length ?? 0;

  // Scale reference: the busiest planned-count across the last 7 days
  // (including today), so the bar's own length conveys "how much was
  // planned today" relative to a normal week, not just a ratio.
  const referenceMax = Math.max(plannedToday, ...(trend ?? []).map((t) => t.planned), 1);
  const plannedWidthPct = Math.min(100, (plannedToday / referenceMax) * 100);
  const completedWidthPct = Math.min(plannedWidthPct, (completedToday / referenceMax) * 100);
  const completionPct = plannedToday > 0 ? Math.round((completedToday / plannedToday) * 100) : 0;

  const trendData = (trend ?? []).map((t) => ({
    ...t,
    label: new Date(t.date).toLocaleDateString(undefined, { weekday: "short" }),
  }));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Today&apos;s task completion</CardTitle>
        </CardHeader>
        <CardContent>
          {today === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : plannedToday === 0 ? (
            <p className="text-sm text-muted-foreground">No tasks planned yet today.</p>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-bold tabular-nums">
                  {completedToday}/{plannedToday}
                </span>
                <span className="text-sm font-medium text-muted-foreground">{completionPct}%</span>
              </div>
              <div className="h-4 w-full overflow-hidden rounded-full bg-muted/50">
                <div
                  className="relative h-full rounded-full bg-neutral-300 transition-[width] dark:bg-neutral-700"
                  style={{ width: `${plannedWidthPct}%` }}
                >
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${(completedWidthPct / plannedWidthPct) * 100}%` }}
                  />
                </div>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>tasks completed</span>
                <span>{notStarted} employee(s) not started</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">7-day completion trend</CardTitle>
        </CardHeader>
        <CardContent>
          {trend === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="h-32 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ left: -20, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<TrendTooltip />} cursor={{ stroke: "currentColor", strokeOpacity: 0.15 }} />
                  <Line type="monotone" dataKey="planned" stroke="#d4d4d8" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="completed" stroke="#6366f1" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
