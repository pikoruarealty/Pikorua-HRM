"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetch } from "@/components/_lib/api";

// Logging work nobody assigned you (2026-08-10). The employee picks a type from
// the Admin-set catalog — never a number — and the points shown here are what
// the type is worth, so there is no negotiation and nothing to estimate. Every
// self-logged task goes to the lead for a yes/no before its points count, which
// the copy says plainly rather than letting it look like free points.

type AdhocType = { id: string; key: string; label: string; points: number };

export function SelfLogForm({ disabled, onLogged }: { disabled: boolean; onLogged: () => void }) {
  const [types, setTypes] = useState<AdhocType[]>([]);
  const [typeKey, setTypeKey] = useState<string>("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<AdhocType[]>("/adhoc-task-types").then((res) => {
      if (res.data) setTypes(res.data);
    });
  }, []);

  const selected = types.find((t) => t.key === typeKey) ?? null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    const res = await apiFetch("/work-items/self-log", {
      method: "POST",
      body: JSON.stringify({
        typeKey,
        title,
        ...(description.trim() ? { description: description.trim() } : {}),
      }),
    });
    setBusy(false);
    if (res.error) return setError(`${res.error.code}: ${res.error.message}`);
    setTitle("");
    setDescription("");
    setNotice("Logged. Mark it complete when you're done and your lead will confirm it.");
    onLogged();
  }

  // An empty catalog means an Admin hasn't set the types up yet. Showing a
  // form with nothing to pick would just produce a confusing failure.
  if (types.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log a task</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-muted-foreground">
          Did work nobody assigned you? Log it here. Pick what kind of work it was — the points are
          fixed per type, so there is nothing to estimate. Your lead confirms it happened before the
          points count.
        </p>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>Kind of work</Label>
            <Select value={typeKey || undefined} onValueChange={setTypeKey} disabled={disabled}>
              <SelectTrigger>
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {types.map((t) => (
                  <SelectItem key={t.key} value={t.key}>
                    {t.label} — {t.points} pts
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>What did you do?</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Fixed the payslip PDF margin bug"
              disabled={disabled}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>Details for your lead (optional)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Anything that helps them confirm it — a ticket number, where to look…"
              disabled={disabled}
            />
          </div>
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={disabled || busy || !typeKey || !title.trim()}>
              Log task
            </Button>
            {selected && (
              <span className="text-sm text-muted-foreground">
                Worth {selected.points} pts once confirmed.
              </span>
            )}
          </div>
          {notice && <p className="text-sm text-muted-foreground sm:col-span-2">{notice}</p>}
          {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
        </form>
      </CardContent>
    </Card>
  );
}
