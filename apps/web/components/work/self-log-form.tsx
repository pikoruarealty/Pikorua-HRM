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

// Free-text mode (2026-08-14, owner request): for work that doesn't fit any
// catalog type. There is no fixed price here — Groq estimates the points from
// the description at logging time, the same way it sizes AI-generated
// assigned tasks, so the description has to carry enough detail for a good
// estimate. Small estimates auto-credit on completion; larger ones still go
// to the lead, same tiered threshold as any other task.
const FREE_TEXT_MIN_DESCRIPTION = 20;

export function SelfLogForm({ disabled, onLogged }: { disabled: boolean; onLogged: () => void }) {
  const [types, setTypes] = useState<AdhocType[]>([]);
  const [mode, setMode] = useState<"catalog" | "freeText">("catalog");
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
  const freeTextReady = description.trim().length >= FREE_TEXT_MIN_DESCRIPTION;
  // No catalog configured yet — free text is the only option, so skip the
  // toggle and just show that form instead of an empty type picker.
  const effectiveMode = types.length === 0 ? "freeText" : mode;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    const res = await apiFetch("/work-items/self-log", {
      method: "POST",
      body: JSON.stringify({
        ...(effectiveMode === "catalog" ? { typeKey } : {}),
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log a task</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-muted-foreground">
          Did work nobody assigned you? Log it here. Your lead confirms it happened before the points
          count.
        </p>
        {types.length > 0 && (
          <div className="mb-3 flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={mode === "catalog" ? "default" : "outline"}
              onClick={() => setMode("catalog")}
              disabled={disabled}
            >
              Pick a type
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "freeText" ? "default" : "outline"}
              onClick={() => setMode("freeText")}
              disabled={disabled}
            >
              Something else
            </Button>
          </div>
        )}
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          {effectiveMode === "catalog" ? (
            <>
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
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label>What did you do?</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="A short title"
                  disabled={disabled}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label>Describe it — this is what your lead prices it on</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="What you did, why it mattered, and where to check it — there's no fixed type here, so this is the whole basis for the points an AI estimates."
                  disabled={disabled}
                  required
                />
                <span className="text-xs text-muted-foreground">
                  {description.trim().length}/{FREE_TEXT_MIN_DESCRIPTION} min · AI estimates the
                  points when you log it — small ones credit automatically once you mark it done,
                  larger ones go to your lead
                </span>
              </div>
            </>
          )}
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button
              type="submit"
              disabled={
                disabled ||
                busy ||
                !title.trim() ||
                (effectiveMode === "catalog" ? !typeKey : !freeTextReady)
              }
            >
              Log task
            </Button>
            {effectiveMode === "catalog" && selected && (
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
