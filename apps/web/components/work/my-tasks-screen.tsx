"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/components/_lib/api";

type WorkItem = {
  id: string;
  title: string;
  mode: "atomic" | "metric";
  status: string;
  taskPoints?: number | null;
  targetValue?: string | null;
  currentValue?: string | null;
};

function ExplainBlock({ workItemId }: { workItemId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    // Fetch once, then cache — re-toggling doesn't re-call the AI.
    if (next && text === null && !loading) {
      setLoading(true);
      setErr(null);
      const res = await apiFetch<{ explanation: string }>(`/work-items/${workItemId}/explain`, {
        method: "POST",
      });
      setLoading(false);
      if (res.error) setErr(`${res.error.code}: ${res.error.message}`);
      else setText(res.data?.explanation ?? "");
    }
  }

  return (
    <div className="mt-2">
      <Button size="sm" variant="outline" onClick={toggle}>
        {open ? "Hide explanation" : "Explain"}
      </Button>
      {open && (
        <div className="mt-2 rounded border bg-muted/30 p-3 text-sm">
          {loading && <p className="text-muted-foreground">Thinking…</p>}
          {err && <p className="text-destructive">{err}</p>}
          {text !== null && <p className="whitespace-pre-wrap">{text}</p>}
        </div>
      )}
    </div>
  );
}

function WorkItemRow({
  wi,
  onComplete,
  onUpdateProgress,
  draft,
  onDraftChange,
}: {
  wi: WorkItem;
  onComplete: (id: string) => void;
  onUpdateProgress: (id: string) => void;
  draft: string;
  onDraftChange: (v: string) => void;
}) {
  return (
    <div className="rounded border p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="font-medium">{wi.title}</span>{" "}
          <span className="text-muted-foreground">({wi.mode})</span>
          <div className="text-muted-foreground">
            {wi.mode === "atomic" ? `${wi.taskPoints} pts` : `${wi.currentValue}/${wi.targetValue}`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{wi.status}</Badge>
          {wi.status !== "completed" &&
            (wi.mode === "atomic" ? (
              <Button size="sm" onClick={() => onComplete(wi.id)}>
                Complete
              </Button>
            ) : (
              <>
                <Input
                  className="w-24"
                  placeholder="new value"
                  value={draft}
                  onChange={(e) => onDraftChange(e.target.value)}
                />
                <Button size="sm" onClick={() => onUpdateProgress(wi.id)}>
                  Update
                </Button>
              </>
            ))}
        </div>
      </div>
      <ExplainBlock workItemId={wi.id} />
    </div>
  );
}

export function MyTasksScreen() {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

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

  async function updateProgress(id: string) {
    setError(null);
    const res = await apiFetch(`/work-items/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ currentValue: Number(drafts[id]) }),
    });
    if (res.error) setError(`${res.error.code}: ${res.error.message}`);
    refresh();
  }

  const active = items.filter((wi) => wi.status !== "completed");
  const completed = items.filter((wi) => wi.status === "completed");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Tasks</h1>
        <p className="text-sm text-muted-foreground">
          Your assigned work items. Completing an atomic task credits its points immediately.
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Active</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {active.length === 0 && <p className="text-sm text-muted-foreground">No active work items.</p>}
          {active.map((wi) => (
            <WorkItemRow
              key={wi.id}
              wi={wi}
              onComplete={complete}
              onUpdateProgress={updateProgress}
              draft={drafts[wi.id] ?? ""}
              onDraftChange={(v) => setDrafts((d) => ({ ...d, [wi.id]: v }))}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-muted-foreground">Completed</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {completed.length === 0 && (
            <p className="text-sm text-muted-foreground">Nothing completed yet.</p>
          )}
          {completed.map((wi) => (
            <div key={wi.id} className="flex items-center justify-between rounded border p-3 text-sm">
              <span className="text-muted-foreground">{wi.title}</span>
              <Badge variant="outline">{wi.status}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
