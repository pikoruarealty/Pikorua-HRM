"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format-date";

type CustomEvent = {
  id: string;
  title: string | null;
  scheduledAt: string | null;
};

async function getJson(res: Response) {
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data;
}

/** Admin/HR: log/view generic one-off milestones (anniversaries, recognition
 *  dates, etc.) tied to this employee — distinct from the auto-derived
 *  birthday/work-anniversary reminders. Only rendered for canManage viewers. */
export function EmployeeEventsPanel({ employeeId }: { employeeId: string }) {
  const [events, setEvents] = useState<CustomEvent[]>([]);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await getJson(
        await fetch(`/api/v1/events/custom?employee_id=${employeeId}`),
      );
      setEvents(data);
    } catch {
      // Non-fatal — panel just shows empty; the rest of the profile still works.
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await getJson(
        await fetch("/api/v1/events/custom", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeId,
            title,
            scheduledAt: new Date(date).toISOString(),
          }),
        }),
      );
      setTitle("");
      setDate("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add event.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Delete this event?")) return;
    await getJson(await fetch(`/api/v1/events/custom/${id}`, { method: "DELETE" }));
    load();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Events</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={onAdd} className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="event_title">Title</Label>
            <Input
              id="event_title"
              placeholder="e.g. 5-year work anniversary"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="event_date">Date</Label>
            <DatePicker id="event_date" value={date} onChange={setDate} required />
          </div>
          <Button type="submit" disabled={submitting} className="self-end">
            {submitting ? "Adding…" : "Add event"}
          </Button>
        </form>
        {error && <p className="text-sm text-destructive">{error}</p>}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events logged yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {events.map((ev) => (
              <li
                key={ev.id}
                className="flex items-center justify-between rounded border p-2 text-sm"
              >
                <span>
                  <span className="font-medium">{ev.title}</span>{" "}
                  <span className="text-muted-foreground">
                    {formatDate(ev.scheduledAt)}
                  </span>
                </span>
                <button
                  type="button"
                  className="text-xs text-destructive underline-offset-2 hover:underline"
                  onClick={() => onDelete(ev.id)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
