"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/components/_lib/api";
import { EmployeeAvatar } from "@/components/employees/employee-avatar";
import { DueDateBadge } from "@/components/work/due-date";
import { formatDate } from "@/lib/format-date";

// Lead inbox for tiered point crediting (Pillar 2, 2026-08-08). Everything here
// is a task the assignee has finished and handed in; accepting is what actually
// credits the points, so nothing in this list has been paid out yet.

type QueueItem = {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  taskPoints: number | null;
  submittedAt: string | null;
  selfLogged: boolean;
  freeText: boolean;
  assignee: { id: string; fullName: string; photoUrl: string | null };
  subUnitId: string;
  subUnitName: string;
  workUnitId: string;
  workUnitName: string;
};

function ReviewRow({ item, onReviewed }: { item: QueueItem; onReviewed: () => void }) {
  const [points, setPoints] = useState(String(item.taskPoints ?? ""));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(action: "accept" | "reject") {
    setError(null);
    const body: Record<string, unknown> = { action };
    if (note.trim()) body.note = note.trim();
    if (action === "accept") {
      const n = Number(points);
      if (!Number.isInteger(n) || n <= 0) return setError("Points must be a positive whole number.");
      body.points = n;
    }
    setBusy(true);
    const res = await apiFetch(`/work-items/${item.id}/review`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (res.error) return setError(`${res.error.code}: ${res.error.message}`);
    onReviewed();
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-start gap-3">
        <EmployeeAvatar photoUrl={item.assignee.photoUrl} fullName={item.assignee.fullName} size="sm" />
        <div className="min-w-[14rem] flex-1">
          <p className="text-sm font-medium">{item.title}</p>
          <p className="text-xs text-muted-foreground">
            <Link href={`/employees/${item.assignee.id}`} className="hover:underline">
              {item.assignee.fullName}
            </Link>{" "}
            ·{" "}
            <Link href={`/work/${item.workUnitId}`} className="hover:underline">
              {item.workUnitName}
            </Link>{" "}
            · {item.subUnitName}
            {item.submittedAt && ` · submitted ${formatDate(item.submittedAt)}`}
          </p>
          {item.description && (
            <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{item.description}</p>
          )}
          {item.freeText && (
            <p className="mt-1 text-xs text-warning">
              Free-text self-log — no catalog type. AI estimated {item.taskPoints ?? "—"} pts from
              the description; accept it as-is or adjust it and say why.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DueDateBadge dueDate={item.dueDate} />
          {item.selfLogged && <Badge variant="secondary">Self-logged</Badge>}
          <Badge variant="outline">{item.taskPoints ?? "—"} pts</Badge>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-8 w-24"
          type="number"
          min={1}
          aria-label="Points to credit"
          value={points}
          onChange={(e) => setPoints(e.target.value)}
          disabled={item.selfLogged && !item.freeText}
        />
        <Textarea
          className="min-w-[16rem] flex-1"
          rows={1}
          aria-label="Review note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Reason — required to send back, or to change the points."
        />
        <Button size="sm" onClick={() => submit("accept")} disabled={busy}>
          Accept &amp; credit
        </Button>
        <Button size="sm" variant="outline" onClick={() => submit("reject")} disabled={busy}>
          Send back
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

export function ReviewQueueScreen() {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await apiFetch<QueueItem[]>("/work-items/review-queue");
    if (res.error) setError(`${res.error.code}: ${res.error.message}`);
    else setItems(res.data ?? []);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/work" className="text-sm text-muted-foreground hover:underline">
          ← Work units
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Task review</h1>
        <p className="text-sm text-muted-foreground">
          Larger tasks wait here after the assignee marks them done. Points are credited only when you
          accept — oldest submission first.
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Awaiting review{items ? ` (${items.length})` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {items === null && <p className="text-sm text-muted-foreground">Loading…</p>}
          {items?.length === 0 && (
            <p className="text-sm text-muted-foreground">Nothing waiting on you. Nice.</p>
          )}
          {items?.map((i) => (
            <ReviewRow key={i.id} item={i} onReviewed={refresh} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
