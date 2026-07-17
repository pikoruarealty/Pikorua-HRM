"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// /calendar — one place for everything in the system that has a date:
// holidays, birthdays, work anniversaries, meetings, and leave (RBAC-scoped
// by the API — the client renders whatever the feed returns). Month grid on
// top, full list view below (the accessible, screen-reader-friendly form of
// the same data). Admin/HR additionally manage holidays here.

type CalendarItem = {
  id: string;
  kind: "holiday" | "birthday" | "anniversary" | "meeting" | "leave";
  date: string;
  title: string;
  subtitle?: string;
  holidayId?: string;
  status?: "pending" | "approved";
  time?: string;
};

const KIND_STYLES: Record<CalendarItem["kind"], { chip: string; dot: string; label: string }> = {
  holiday: { chip: "bg-amber-500/15 text-amber-700 dark:text-amber-400", dot: "bg-amber-500", label: "Holiday" },
  birthday: { chip: "bg-pink-500/15 text-pink-700 dark:text-pink-400", dot: "bg-pink-500", label: "Birthday" },
  anniversary: { chip: "bg-violet-500/15 text-violet-700 dark:text-violet-400", dot: "bg-violet-500", label: "Anniversary" },
  meeting: { chip: "bg-blue-500/15 text-blue-700 dark:text-blue-400", dot: "bg-blue-500", label: "Meeting" },
  leave: { chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500", label: "Leave" },
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

async function getJson(res: Response) {
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

const ALL_KINDS = Object.keys(KIND_STYLES) as CalendarItem["kind"][];

export function CalendarScreen({ canManageHolidays }: { canManageHolidays: boolean }) {
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedKinds, setSelectedKinds] = useState<Set<CalendarItem["kind"]>>(new Set(ALL_KINDS));

  function toggleKind(kind: CalendarItem["kind"]) {
    setSelectedKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  const [holidayDate, setHolidayDate] = useState("");
  const [holidayName, setHolidayName] = useState("");
  const [savingHoliday, setSavingHoliday] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getJson(await fetch(`/api/v1/calendar?month=${month}&year=${year}`));
      setItems(data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load calendar.");
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  useEffect(() => {
    load();
  }, [load]);

  function shiftMonth(delta: number) {
    const next = new Date(year, month - 1 + delta, 1);
    setMonth(next.getMonth() + 1);
    setYear(next.getFullYear());
  }

  async function onAddHoliday(e: React.FormEvent) {
    e.preventDefault();
    setSavingHoliday(true);
    setError(null);
    try {
      await getJson(
        await fetch("/api/v1/holidays", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: holidayDate, name: holidayName }),
        }),
      );
      setHolidayDate("");
      setHolidayName("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add holiday.");
    } finally {
      setSavingHoliday(false);
    }
  }

  async function onDeleteHoliday(holidayId: string, title: string) {
    if (!confirm(`Remove the holiday "${title}"?`)) return;
    try {
      await getJson(await fetch(`/api/v1/holidays/${holidayId}`, { method: "DELETE" }));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete holiday.");
    }
  }

  // ---- month grid math (Monday-first) ----
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = (new Date(year, month - 1, 1).getDay() + 6) % 7; // 0 = Monday
  const cells: (number | null)[] = [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const visibleItems = items.filter((i) => selectedKinds.has(i.kind));

  const byDate = new Map<string, CalendarItem[]>();
  for (const item of visibleItems) {
    const list = byDate.get(item.date) ?? [];
    list.push(item);
    byDate.set(item.date, list);
  }

  const todayIso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const monthLabel = `${MONTHS[month - 1]} ${year}`;
  const sortedDates = [...byDate.keys()].sort();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight" aria-live="polite">
          {monthLabel}
        </h1>
        <div className="flex items-center gap-2" role="group" aria-label="Change month">
          <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setMonth(today.getMonth() + 1);
              setYear(today.getFullYear());
            }}
          >
            Today
          </Button>
          <Button variant="outline" size="icon" aria-label="Next month" onClick={() => shiftMonth(1)}>
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter event types">
        {ALL_KINDS.map((kind) => {
          const style = KIND_STYLES[kind];
          const selected = selectedKinds.has(kind);
          return (
            <button
              key={kind}
              type="button"
              aria-pressed={selected}
              onClick={() => toggleKind(kind)}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                selected
                  ? "border-transparent bg-muted text-foreground"
                  : "border-border text-muted-foreground opacity-50 hover:opacity-80"
              }`}
            >
              <span className={`h-2.5 w-2.5 rounded-full ${style.dot}`} />
              {style.label}
            </button>
          );
        })}
      </div>

      {canManageHolidays && (
        <Card>
          <CardHeader>
            <CardTitle>Add a holiday</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onAddHoliday} className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="holiday_date">Date</Label>
                <Input
                  id="holiday_date"
                  type="date"
                  value={holidayDate}
                  onChange={(e) => setHolidayDate(e.target.value)}
                  required
                />
              </div>
              <div className="flex min-w-56 flex-1 flex-col gap-2">
                <Label htmlFor="holiday_name">Name</Label>
                <Input
                  id="holiday_name"
                  placeholder="e.g. Diwali"
                  value={holidayName}
                  onChange={(e) => setHolidayName(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" disabled={savingHoliday}>
                {savingHoliday ? "Adding…" : "Add holiday"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading calendar…</p>
          ) : (
            <table className="w-full table-fixed border-collapse" aria-label={`Calendar for ${monthLabel}`}>
              <thead>
                <tr>
                  {WEEKDAYS.map((d) => (
                    <th key={d} scope="col" className="pb-2 text-xs font-medium text-muted-foreground">
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: cells.length / 7 }, (_, row) => (
                  <tr key={row}>
                    {cells.slice(row * 7, row * 7 + 7).map((day, col) => {
                      if (day === null) {
                        return <td key={col} className="border bg-muted/30" aria-hidden />;
                      }
                      const iso = `${year}-${pad(month)}-${pad(day)}`;
                      const dayItems = byDate.get(iso) ?? [];
                      const isToday = iso === todayIso;
                      return (
                        <td
                          key={col}
                          className={`h-24 w-[14.28%] border p-1 align-top ${isToday ? "bg-primary/5 ring-2 ring-inset ring-primary" : ""}`}
                          aria-label={`${MONTHS[month - 1]} ${day}, ${year}${dayItems.length ? `: ${dayItems.map((i) => i.title).join("; ")}` : ""}`}
                        >
                          <div className={`mb-1 text-xs font-semibold ${isToday ? "text-primary" : ""}`}>{day}</div>
                          <div className="flex flex-col gap-0.5 overflow-hidden">
                            {dayItems.slice(0, 3).map((item) => (
                              <span
                                key={item.id}
                                title={`${item.title}${item.subtitle ? ` — ${item.subtitle}` : ""}`}
                                className={`truncate rounded px-1 py-px text-[10px] leading-4 ${KIND_STYLES[item.kind].chip} ${item.status === "pending" ? "opacity-60" : ""}`}
                              >
                                {item.time ? `${item.time} ` : ""}
                                {item.title}
                              </span>
                            ))}
                            {dayItems.length > 3 && (
                              <span className="px-1 text-[10px] text-muted-foreground">
                                +{dayItems.length - 3} more
                              </span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All events in {monthLabel}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : sortedDates.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing scheduled this month.</p>
          ) : (
            <ol className="flex flex-col gap-4">
              {sortedDates.map((date) => (
                <li key={date}>
                  <h3 className="mb-1.5 text-sm font-semibold">
                    {new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })}
                    {date === todayIso && <Badge className="ml-2">Today</Badge>}
                  </h3>
                  <ul className="flex flex-col gap-1.5">
                    {(byDate.get(date) ?? []).map((item) => (
                      <li key={item.id} className="flex items-center gap-2 text-sm">
                        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${KIND_STYLES[item.kind].dot}`} aria-hidden />
                        <span className="sr-only">{KIND_STYLES[item.kind].label}:</span>
                        <span>
                          {item.time ? `${item.time} — ` : ""}
                          {item.title}
                        </span>
                        {item.subtitle && item.subtitle !== item.title && (
                          <span className="text-muted-foreground">· {item.subtitle}</span>
                        )}
                        {item.status === "pending" && <Badge variant="outline">pending approval</Badge>}
                        {canManageHolidays && item.holidayId && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            aria-label={`Delete holiday ${item.title}`}
                            onClick={() => onDeleteHoliday(item.holidayId!, item.title)}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
