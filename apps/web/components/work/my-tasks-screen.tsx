"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/components/_lib/api";
import { useAttendanceStatus } from "@/components/_lib/use-attendance-status";
import { DueDateBadge } from "@/components/work/due-date";
import { WorkItemStatusBadge } from "@/components/work/status-badge";
import { SelfLogForm } from "@/components/work/self-log-form";
import { isMetricDepartment } from "@/lib/departments/type";

type Me = { employee: { department: { typeKey: string } | null } | null };

type WorkItem = {
  id: string;
  title: string;
  description?: string | null;
  dueDate?: string | null;
  mode: "atomic" | "metric";
  status: string;
  taskPoints?: number | null;
  targetValue?: string | null;
  currentValue?: string | null;
  reviewNote?: string | null;
  selfLogged?: boolean;
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
  onDelete,
  draft,
  onDraftChange,
  disabled,
}: {
  wi: WorkItem;
  onComplete: (id: string) => void;
  onUpdateProgress: (id: string) => void;
  onDelete: (id: string) => void;
  draft: string;
  onDraftChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="rounded border p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="font-medium">{wi.title}</span>{" "}
          <span className="text-muted-foreground">({wi.mode})</span>
          <div className="text-muted-foreground">
            {wi.mode === "atomic"
              ? wi.taskPoints != null
                ? `${wi.taskPoints} pts`
                : "points set by lead on review"
              : `${wi.currentValue}/${wi.targetValue}`}
          </div>
          {wi.description && (
            <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{wi.description}</p>
          )}
          {/* Only surfaced when the task is back in the employee's hands —
              on an accepted task the note is the lead's sign-off, not an
              action item, and would just add noise here. */}
          {wi.status === "wip" && wi.reviewNote && (
            <p className="mt-1 text-xs text-warning">Sent back: {wi.reviewNote}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <DueDateBadge dueDate={wi.dueDate} completed={wi.status === "completed"} />
          <WorkItemStatusBadge status={wi.status} />
          {wi.status !== "completed" &&
            wi.status !== "in_review" &&
            (wi.mode === "atomic" ? (
              <Button size="sm" onClick={() => onComplete(wi.id)} disabled={disabled}>
                Complete
              </Button>
            ) : (
              <>
                <Input
                  className="w-24"
                  placeholder="new value"
                  value={draft}
                  onChange={(e) => onDraftChange(e.target.value)}
                  disabled={disabled}
                />
                <Button size="sm" onClick={() => onUpdateProgress(wi.id)} disabled={disabled}>
                  Update
                </Button>
              </>
            ))}
          {/* Self-retract: only a task the employee logged themselves, and only
              before it's gone to their lead for review — once it's submitted
              it's out of their hands, same as any other work item. */}
          {wi.selfLogged && wi.status === "pending" && (
            <Button
              size="sm"
              variant="outline"
              className="text-destructive"
              onClick={() => onDelete(wi.id)}
              disabled={disabled}
            >
              Delete
            </Button>
          )}
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
  const [isMetric, setIsMetric] = useState(false);
  const { clockedIn, clockedOut, loading: attendanceLoading } = useAttendanceStatus();
  // Progress is logged only while actually clocked in. Clocking out no longer
  // ends the day — they can clock straight back in and carry on.
  const canModify = clockedIn;

  async function refresh() {
    const res = await apiFetch<WorkItem[]>("/work-items/mine");
    if (res.data) setItems(res.data);
    if (res.error) setError(`${res.error.code}: ${res.error.message}`);
  }

  useEffect(() => {
    refresh();
    apiFetch<Me>("/auth/me").then((res) => {
      if (res.data) setIsMetric(isMetricDepartment(res.data.employee?.department?.typeKey));
    });
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

  async function deleteItem(id: string) {
    setError(null);
    const res = await apiFetch(`/work-items/${id}`, { method: "DELETE" });
    if (res.error) setError(`${res.error.code}: ${res.error.message}`);
    refresh();
  }

  // Soonest-due first so what's urgent is at the top; undated tasks keep their
  // server order (newest first) behind the dated ones.
  const active = items
    .filter((wi) => wi.status !== "completed")
    .sort((a, b) => {
      if (a.dueDate === b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate < b.dueDate ? -1 : 1;
    });
  const completed = items.filter((wi) => wi.status === "completed");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Tasks</h1>
        <p className="text-sm text-muted-foreground">
          Your assigned work items. Completing an atomic task credits its points immediately — larger
          tasks, and anything you logged yourself, go to your lead for a quick check first, then the
          points land.
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!attendanceLoading && !canModify && (
        <p className="rounded border bg-muted/30 p-3 text-sm text-muted-foreground">
          {clockedOut ? "You're clocked out right now — " : "You're not clocked in — "}
          <Link href="/planning" className="underline">
            clock {clockedOut ? "back " : ""}in from Daily Planning
          </Link>{" "}
          to update your tasks.
        </p>
      )}

      {/* Placed above the list on purpose: the employee this is for is the one
          looking at an empty Active card and wondering what to do. Sales/BD
          employees don't get this card — the ad-hoc catalog is tech-only, and
          their equivalent ("did work outside the dialer") is offline-call
          claims on the Sales Activity screen. */}
      {isMetric ? (
        <p className="rounded border bg-muted/30 p-3 text-sm text-muted-foreground">
          Did calls, site visits, or bookings outside the system? Log them as an{" "}
          <Link href="/sales" className="underline">
            offline-call claim
          </Link>{" "}
          for your lead to verify.
        </p>
      ) : (
        <SelfLogForm disabled={!canModify || attendanceLoading} onLogged={refresh} />
      )}

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
              onDelete={deleteItem}
              draft={drafts[wi.id] ?? ""}
              onDraftChange={(v) => setDrafts((d) => ({ ...d, [wi.id]: v }))}
              disabled={!canModify || attendanceLoading}
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
              <WorkItemStatusBadge status={wi.status} />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
