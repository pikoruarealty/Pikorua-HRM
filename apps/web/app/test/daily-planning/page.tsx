"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiFetch } from "../_lib/api";

type WorkItem = { id: string; title: string; status: string };
type Selection = { id: string; workItemId: string; workItem: WorkItem };

export default function DailyPlanningPage() {
  const [mine, setMine] = useState<WorkItem[]>([]);
  const [today, setToday] = useState<Selection[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const [mineRes, todayRes] = await Promise.all([
      apiFetch<WorkItem[]>("/work-items/mine"),
      apiFetch<Selection[]>("/daily-selections/today"),
    ]);
    if (mineRes.data) setMine(mineRes.data);
    if (todayRes.data) setToday(todayRes.data);
    if (todayRes.error) setError(`${todayRes.error.code}: ${todayRes.error.message}`);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function submitSelection() {
    setError(null);
    const workItemIds = Object.entries(checked).filter(([, v]) => v).map(([id]) => id);
    if (workItemIds.length === 0) return;
    const res = await apiFetch("/daily-selections", {
      method: "POST",
      body: JSON.stringify({ workItemIds }),
    });
    if (res.error) setError(`${res.error.code}: ${res.error.message}`);
    setChecked({});
    refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Select today&apos;s tasks (POST /daily-selections)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {mine.length === 0 && <p className="text-sm text-muted-foreground">No assigned work items.</p>}
          {mine.map((wi) => (
            <label key={wi.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!checked[wi.id]}
                onChange={(e) => setChecked((c) => ({ ...c, [wi.id]: e.target.checked }))}
              />
              {wi.title} <span className="text-muted-foreground">({wi.status})</span>
            </label>
          ))}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button className="w-fit" onClick={submitSelection}>Save selection</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Today&apos;s selection (GET /daily-selections/today)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {today.length === 0 && <p className="text-sm text-muted-foreground">Nothing selected yet today.</p>}
          {today.map((s) => (
            <div key={s.id} className="rounded border p-2 text-sm">
              {s.workItem?.title} <span className="text-muted-foreground">({s.workItem?.status})</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
