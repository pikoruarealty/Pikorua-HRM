"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "../_lib/api";

type WorkItem = {
  id: string;
  title: string;
  mode: "atomic" | "metric";
  status: string;
  taskPoints?: number | null;
  targetValue?: string | null;
  currentValue?: string | null;
};

export default function MyWorkItemsPage() {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [currentValueDrafts, setCurrentValueDrafts] = useState<Record<string, string>>({});

  async function refresh() {
    const res = await apiFetch<WorkItem[]>("/work-items/mine");
    if (res.data) setItems(res.data);
    if (res.error) setError(`${res.error.code}: ${res.error.message}`);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function complete(id: string) {
    setError(null);
    const res = await apiFetch(`/work-items/${id}/complete`, { method: "POST" });
    if (res.error) setError(`${res.error.code}: ${res.error.message}`);
    refresh();
  }

  async function updateCurrentValue(id: string) {
    setError(null);
    const value = currentValueDrafts[id];
    const res = await apiFetch(`/work-items/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ currentValue: Number(value) }),
    });
    if (res.error) setError(`${res.error.code}: ${res.error.message}`);
    refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">My Work Items (GET /work-items/mine)</h1>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {items.length === 0 && <p className="text-sm text-muted-foreground">No work items assigned.</p>}
      {items.map((wi) => (
        <Card key={wi.id}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span>{wi.title} <span className="text-muted-foreground text-sm">({wi.mode})</span></span>
              <Badge variant="outline">{wi.status}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-3">
            {wi.mode === "atomic" ? (
              <>
                <span className="text-sm text-muted-foreground">{wi.taskPoints} pts</span>
                <Button size="sm" disabled={wi.status === "completed"} onClick={() => complete(wi.id)}>
                  {wi.status === "completed" ? "Completed" : "Complete"}
                </Button>
              </>
            ) : (
              <>
                <span className="text-sm text-muted-foreground">{wi.currentValue}/{wi.targetValue}</span>
                <Input
                  className="w-24"
                  placeholder="new value"
                  value={currentValueDrafts[wi.id] ?? ""}
                  onChange={(e) => setCurrentValueDrafts((d) => ({ ...d, [wi.id]: e.target.value }))}
                />
                <Button size="sm" onClick={() => updateCurrentValue(wi.id)}>Update progress</Button>
              </>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
