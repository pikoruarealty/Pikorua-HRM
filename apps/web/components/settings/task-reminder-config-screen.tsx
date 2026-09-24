"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

async function getJson(res: Response) {
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data;
}

type ContentMode = "count" | "full_list" | "per_task";
type Scope = "due_today" | "all_pending";

type Config = {
  enabled: boolean;
  intervalMinutes: number;
  contentMode: ContentMode;
  scope: Scope;
};

const CONTENT_MODE_LABEL: Record<ContentMode, string> = {
  count: "Just the count (“You have 5 pending tasks”)",
  full_list: "Full list in one notification",
  per_task: "A separate notification for each pending task",
};

const SCOPE_LABEL: Record<Scope, string> = {
  due_today: "Only tasks due today",
  all_pending: "Every open task, regardless of due date",
};

const INTERVAL_PRESETS = [
  { label: "Every 30 min", minutes: 30 },
  { label: "Every hour", minutes: 60 },
  { label: "Every 2 hours", minutes: 120 },
  { label: "Every 4 hours", minutes: 240 },
  { label: "Once a day", minutes: 1440 },
];

export function TaskReminderConfigScreen({ canEdit }: { canEdit: boolean }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(true);
  const [intervalMinutes, setIntervalMinutes] = useState("120");
  const [contentMode, setContentMode] = useState<ContentMode>("count");
  const [scope, setScope] = useState<Scope>("all_pending");
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data: Config = await getJson(await fetch("/api/v1/task-reminders/config"));
      setConfig(data);
      setEnabled(data.enabled);
      setIntervalMinutes(String(data.intervalMinutes));
      setContentMode(data.contentMode);
      setScope(data.scope);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load task reminder config.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSaveError(null);
    setSaved(false);
    try {
      await getJson(
        await fetch("/api/v1/task-reminders/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enabled,
            interval_minutes: intervalMinutes,
            content_mode: contentMode,
            scope,
          }),
        }),
      );
      await load();
      setSaved(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Task reminders</h1>
        <p className="text-sm text-muted-foreground">
          A nudge for anyone with open tasks — how often it fires, what it says, and which tasks it
          counts. Applies org-wide; there is no per-employee override.
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reminder settings</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">Status</dt>
                <dd className="font-medium">
                  <Badge variant={config?.enabled ? "default" : "secondary"}>
                    {config?.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Every</dt>
                <dd className="font-medium">{config?.intervalMinutes} min</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Content</dt>
                <dd className="font-medium">{config && CONTENT_MODE_LABEL[config.contentMode]}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Scope</dt>
                <dd className="font-medium">{config && SCOPE_LABEL[config.scope]}</dd>
              </div>
            </dl>
          )}

          {canEdit && (
            <form onSubmit={onSubmit} className="flex flex-col gap-4 border-t pt-4">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={enabled} onCheckedChange={setEnabled} />
                Send pending-task reminders
              </label>

              <div className="flex flex-col gap-2">
                <Label htmlFor="reminder-interval">Interval (minutes)</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    id="reminder-interval"
                    type="number"
                    min={5}
                    max={1440}
                    required
                    value={intervalMinutes}
                    onChange={(e) => setIntervalMinutes(e.target.value)}
                    className="w-28"
                  />
                  <div className="flex flex-wrap gap-1">
                    {INTERVAL_PRESETS.map((p) => (
                      <Button
                        key={p.minutes}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setIntervalMinutes(String(p.minutes))}
                      >
                        {p.label}
                      </Button>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Checked every 15 minutes in the background; each employee gets at most one reminder
                  per interval, and only while they are clocked in.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="reminder-content">What to show</Label>
                <Select value={contentMode} onValueChange={(v) => setContentMode(v as ContentMode)}>
                  <SelectTrigger id="reminder-content" className="w-full sm:w-96">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="count">{CONTENT_MODE_LABEL.count}</SelectItem>
                    <SelectItem value="full_list">{CONTENT_MODE_LABEL.full_list}</SelectItem>
                    <SelectItem value="per_task">{CONTENT_MODE_LABEL.per_task}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="reminder-scope">Which tasks count</Label>
                <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
                  <SelectTrigger id="reminder-scope" className="w-full sm:w-96">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all_pending">{SCOPE_LABEL.all_pending}</SelectItem>
                    <SelectItem value="due_today">{SCOPE_LABEL.due_today}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {saveError && <p className="text-sm text-destructive">{saveError}</p>}
              {saved && !saveError && <p className="text-sm text-muted-foreground">Saved.</p>}
              <div>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Saving…" : "Save"}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
