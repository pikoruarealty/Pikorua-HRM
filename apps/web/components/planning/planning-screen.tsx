"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/components/_lib/api";

type WorkItem = { id: string; title: string; status: string };
type Selection = { id: string; workItemId: string; workItem: WorkItem };
type AttendanceRecord = {
  id: string;
  date: string;
  clockInRaw: string | null;
  clockOutRaw: string | null;
};
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
  pointsEarnedToday: number;
  items: EodItem[];
};

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function PlanningScreen({ isAdmin = false }: { isAdmin?: boolean }) {
  const [mine, setMine] = useState<WorkItem[]>([]);
  const [today, setToday] = useState<Selection[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord | null>(null);
  const [eod, setEod] = useState<Eod | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [mineRes, todayRes, attRes, eodRes] = await Promise.all([
      apiFetch<WorkItem[]>("/work-items/mine"),
      apiFetch<Selection[]>("/daily-selections/today"),
      apiFetch<AttendanceRecord[]>("/attendance"),
      apiFetch<Eod>("/attendance/eod"),
    ]);
    if (mineRes.data) setMine(mineRes.data);
    if (todayRes.data) setToday(todayRes.data);
    if (eodRes.data) setEod(eodRes.data);
    if (attRes.data) {
      const t = todayUtc();
      setAttendance(attRes.data.find((r) => r.date.slice(0, 10) === t) ?? null);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const activeItems = mine.filter((wi) => wi.status !== "completed");
  const clockedIn = !!attendance?.clockInRaw;
  const clockedOut = !!attendance?.clockOutRaw;
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
      body: JSON.stringify(workItemIds.length ? { workItemIds } : {}),
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

  async function clockOut() {
    setError(null);
    setBusy(true);
    const res = await apiFetch<{ eod: Eod }>("/attendance/clock-out", { method: "POST" });
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
              {clockedOut ? "clocked out" : clockedIn ? "clocked in" : "not clocked in"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!clockedIn && (
            <>
              <p className="text-sm text-muted-foreground">
                {activeItems.length > 0
                  ? "Select at least one task for today, then clock in."
                  : "You have no active tasks to plan — you can clock in directly."}
              </p>
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
                    {wi.title} <span className="text-muted-foreground">({wi.status})</span>
                  </label>
                ))}
              </div>
              <Button className="w-fit" onClick={clockIn} disabled={busy || clockInBlocked}>
                Clock in{selectedIds().length ? ` with ${selectedIds().length} task(s)` : ""}
              </Button>
              {clockInBlocked && (
                <p className="text-xs text-muted-foreground">
                  Select at least one task above to clock in.
                </p>
              )}
            </>
          )}

          {clockedIn && !clockedOut && (
            <>
              <p className="text-sm text-muted-foreground">
                Clocked in at {new Date(attendance!.clockInRaw!).toLocaleTimeString()}. Add more tasks
                below, or clock out to wrap up the day.
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
                      </label>
                    ))}
                  <Button variant="outline" className="w-fit" onClick={addTasks} disabled={busy}>
                    Add selected to today
                  </Button>
                </div>
              )}
              <Button className="w-fit" onClick={clockOut} disabled={busy}>
                Clock out &amp; generate EOD
              </Button>
            </>
          )}

          {clockedOut && (
            <p className="text-sm text-muted-foreground">
              Clocked out at {new Date(attendance!.clockOutRaw!).toLocaleTimeString()}. See your EOD
              summary below.
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
              <Badge variant="outline">{s.workItem?.status}</Badge>
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
              <strong>{eod.completedCount}</strong> · earned{" "}
              <strong>{eod.pointsEarnedToday}</strong> pts today
            </p>
            {eod.items.map((i) => (
              <div key={i.workItemId} className="flex items-center justify-between rounded border p-2">
                <span>{i.title}</span>
                <div className="flex items-center gap-2">
                  {i.completedToday && <Badge>done today</Badge>}
                  <Badge variant="outline">{i.status}</Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
