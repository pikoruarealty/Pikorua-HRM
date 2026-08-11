"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/components/_lib/api";
import { useAttendanceStatus } from "@/components/_lib/use-attendance-status";
import { DueDateBadge } from "@/components/work/due-date";
import { WorkItemStatusBadge, statusLabel } from "@/components/work/status-badge";

type WorkItem = { id: string; title: string; status: string; dueDate?: string | null };
type Selection = { id: string; workItemId: string; workItem: WorkItem };
type EodItem = {
  workItemId: string;
  title: string;
  mode: string;
  status: string;
  completedToday: boolean;
};
type Eod = {
  date: string;
  plannedCount: number;
  completedCount: number;
  inReviewCount: number;
  pointsEarnedToday: number;
  items: EodItem[];
};

export function PlanningScreen({ isAdmin = false }: { isAdmin?: boolean }) {
  const [mine, setMine] = useState<WorkItem[]>([]);
  const [today, setToday] = useState<Selection[]>([]);
  const [eod, setEod] = useState<Eod | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [workLocation, setWorkLocation] = useState<"office" | "wfh">("office");
  const {
    attendance,
    sessions,
    openSession,
    clockedIn,
    clockedOut,
    refresh: refreshAttendance,
  } = useAttendanceStatus();

  async function refresh() {
    const [mineRes, todayRes, eodRes] = await Promise.all([
      apiFetch<WorkItem[]>("/work-items/mine"),
      apiFetch<Selection[]>("/daily-selections/today"),
      apiFetch<Eod>("/attendance/eod"),
    ]);
    if (mineRes.data) setMine(mineRes.data);
    if (todayRes.data) setToday(todayRes.data);
    if (eodRes.data) setEod(eodRes.data);
    refreshAttendance();
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // `in_review` tasks are out of the employee's hands until their lead acts, so
  // they're not pickable for today's plan — same rule the clock-in route
  // enforces server-side.
  const activeItems = mine.filter((wi) => wi.status !== "completed" && wi.status !== "in_review");
  // Must pick ≥1 task to clock in when there are active tasks to pick from
  // (mirrors the server rule); someone with nothing assigned can still clock in.
  const clockInBlocked = activeItems.length > 0 && Object.values(checked).every((v) => !v);

  const selectedIds = () =>
    Object.entries(checked)
      .filter(([, v]) => v)
      .map(([id]) => id);

  async function clockIn() {
    setError(null);
    setBusy(true);
    const workItemIds = selectedIds();
    const res = await apiFetch("/attendance/clock-in", {
      method: "POST",
      body: JSON.stringify({ ...(workItemIds.length ? { workItemIds } : {}), workLocation }),
    });
    setBusy(false);
    if (res.error) setError(`${res.error.code}: ${res.error.message}`);
    setChecked({});
    refresh();
  }

  async function addTasks() {
    setError(null);
    const workItemIds = selectedIds();
    if (workItemIds.length === 0) return;
    setBusy(true);
    const res = await apiFetch("/daily-selections", {
      method: "POST",
      body: JSON.stringify({ workItemIds }),
    });
    setBusy(false);
    if (res.error) setError(`${res.error.code}: ${res.error.message}`);
    setChecked({});
    refresh();
  }

  // `endOfDay: false` is "stepping out" — it closes the current session but
  // doesn't wrap the day up or report it to management, and the employee can
  // clock straight back in. They just can't log any progress while out.
  async function clockOut(endOfDay: boolean) {
    setError(null);
    setBusy(true);
    const res = await apiFetch<{ eod: Eod }>("/attendance/clock-out", {
      method: "POST",
      body: JSON.stringify({ endOfDay }),
    });
    setBusy(false);
    if (res.error) {
      setError(`${res.error.code}: ${res.error.message}`);
      return;
    }
    if (res.data?.eod) setEod(res.data.eod);
    refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Daily Planning</h1>
        <p className="text-sm text-muted-foreground">
          Clock in with the tasks you plan to work on today. Clock out to generate your EOD summary.
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {!isAdmin && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Attendance
            <Badge variant={clockedIn ? "default" : "outline"}>
              {clockedIn ? "clocked in" : clockedOut ? "clocked out" : "not clocked in"}
            </Badge>
            {clockedIn && openSession?.workLocation === "wfh" && (
              <Badge variant="outline">work from home</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!clockedIn && (
            <>
              <p className="text-sm text-muted-foreground">
                {clockedOut
                  ? "You're clocked out. Clock in again to keep working — you can't log progress while you're out."
                  : activeItems.length > 0
                    ? "Select at least one task for today, then clock in."
                    : "You have no active tasks to plan — you can clock in directly."}
              </p>
              {!clockedOut && (
                <div className="flex flex-col gap-2">
                  {activeItems.length === 0 && (
                    <p className="text-sm text-muted-foreground">No active work items to plan.</p>
                  )}
                  {activeItems.map((wi) => (
                    <label key={wi.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!!checked[wi.id]}
                        onChange={(e) => setChecked((c) => ({ ...c, [wi.id]: e.target.checked }))}
                      />
                      {wi.title} <span className="text-muted-foreground">({statusLabel(wi.status)})</span>
                      <DueDateBadge dueDate={wi.dueDate} />
                    </label>
                  ))}
                </div>
              )}
              {/* Where they're working from. A WFH day is a fully worked, fully
                  paid day — it just isn't recorded by the office device. */}
              <div className="flex items-center gap-3 text-sm">
                <span className="text-muted-foreground">Working from</span>
                {(["office", "wfh"] as const).map((loc) => (
                  <label key={loc} className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="workLocation"
                      checked={workLocation === loc}
                      onChange={() => setWorkLocation(loc)}
                    />
                    {loc === "office" ? "Office" : "Home"}
                  </label>
                ))}
              </div>
              <Button className="w-fit" onClick={clockIn} disabled={busy || (!clockedOut && clockInBlocked)}>
                {clockedOut ? "Clock back in" : "Clock in"}
                {!clockedOut && selectedIds().length ? ` with ${selectedIds().length} task(s)` : ""}
              </Button>
              {!clockedOut && clockInBlocked && (
                <p className="text-xs text-muted-foreground">
                  Select at least one task above to clock in.
                </p>
              )}
            </>
          )}

          {clockedIn && (
            <>
              <p className="text-sm text-muted-foreground">
                Clocked in at {new Date(openSession!.clockIn).toLocaleTimeString()}
                {sessions.length > 1 ? ` (session ${sessions.length} today)` : ""}. Add more tasks
                below, step out for a break, or clock out to wrap up the day.
              </p>
              {activeItems.length > 0 && (
                <div className="flex flex-col gap-2">
                  {activeItems
                    .filter((wi) => !today.some((s) => s.workItemId === wi.id))
                    .map((wi) => (
                      <label key={wi.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={!!checked[wi.id]}
                          onChange={(e) => setChecked((c) => ({ ...c, [wi.id]: e.target.checked }))}
                        />
                        {wi.title}
                        <DueDateBadge dueDate={wi.dueDate} />
                      </label>
                    ))}
                  <Button variant="outline" className="w-fit" onClick={addTasks} disabled={busy}>
                    Add selected to today
                  </Button>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="w-fit" onClick={() => clockOut(false)} disabled={busy}>
                  Step out (break)
                </Button>
                <Button className="w-fit" onClick={() => clockOut(true)} disabled={busy}>
                  Clock out &amp; generate EOD
                </Button>
              </div>
            </>
          )}

          {clockedOut && attendance?.clockOutRaw && (
            <p className="text-xs text-muted-foreground">
              Last clocked out at {new Date(attendance.clockOutRaw).toLocaleTimeString()}
              {sessions.length > 1 ? ` · ${sessions.length} sessions today` : ""}.
            </p>
          )}
        </CardContent>
      </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Today&apos;s plan</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {today.length === 0 && (
            <p className="text-sm text-muted-foreground">Nothing selected yet today.</p>
          )}
          {today.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded border p-2 text-sm">
              <span>{s.workItem?.title}</span>
              <WorkItemStatusBadge status={s.workItem?.status ?? "pending"} />
            </div>
          ))}
        </CardContent>
      </Card>

      {eod && (
        <Card>
          <CardHeader>
            <CardTitle>EOD summary · {eod.date}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p>
              Planned <strong>{eod.plannedCount}</strong> · completed{" "}
              <strong>{eod.completedCount}</strong>
              {eod.inReviewCount > 0 && (
                <>
                  {" "}
                  · awaiting review <strong>{eod.inReviewCount}</strong>
                </>
              )}{" "}
              · earned <strong>{eod.pointsEarnedToday}</strong> pts today
            </p>
            {eod.inReviewCount > 0 && (
              <p className="text-xs text-muted-foreground">
                Points for tasks awaiting review are credited once your lead accepts them.
              </p>
            )}
            {eod.items.map((i) => (
              <div key={i.workItemId} className="flex items-center justify-between rounded border p-2">
                <span>{i.title}</span>
                <div className="flex items-center gap-2">
                  {i.completedToday && <Badge>done today</Badge>}
                  <WorkItemStatusBadge status={i.status} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
