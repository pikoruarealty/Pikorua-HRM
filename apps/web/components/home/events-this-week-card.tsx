"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/components/_lib/api";
import { formatTime } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import type { WeekEventItem, WeekEventKind } from "@/lib/events/week";

type WeekEvents = { week: { start: string; end: string; today: string }; items: WeekEventItem[] };

const KIND: Record<WeekEventKind, { emoji: string; label: string }> = {
  meeting: { emoji: "🗓️", label: "Meeting" },
  holiday: { emoji: "🏖️", label: "Holiday" },
  birthday: { emoji: "🎉", label: "Birthday" },
  anniversary: { emoji: "🎊", label: "Anniversary" },
  custom: { emoji: "📌", label: "Event" },
};

// Keys are plain calendar dates, so format them as UTC to stop the browser's own
// timezone from shifting the day.
function dayLabel(key: string): { weekday: string; date: string } {
  const d = new Date(`${key}T00:00:00Z`);
  return {
    weekday: d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }),
    date: d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }),
  };
}

/** What is left of the week, e.g. "4 Oct – 11 Oct" (just "11 Oct" on the last day). */
function remainingRange(week: WeekEvents["week"]): string {
  const from = dayLabel(week.today).date;
  const to = dayLabel(week.end).date;
  return from === to ? to : `${from} – ${to}`;
}

/** "Coming up this week": what is left of the current Monday–Sunday (IST) —
 *  today's birthdays, anniversaries, milestones, holidays and meetings, picked out
 *  at the top, then the rest of the week as normal rows. Anything earlier in the
 *  week is dropped (the API still returns the whole week). This card also replaces
 *  the old "Today: …" banner, so today's celebrations live here. */
export function EventsThisWeekCard({ className }: { className?: string }) {
  const [data, setData] = useState<WeekEvents | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    apiFetch<WeekEvents>("/events/week").then((r) => {
      if (r.data) setData(r.data);
      else setFailed(true);
    });
  }, []);

  // A failed load just leaves the dashboard without the card, like its siblings.
  if (failed) return null;

  // Dates are YYYY-MM-DD, so string comparison is date comparison.
  const items = data ? data.items.filter((i) => i.date >= data.week.today) : [];
  const todayCount = data ? items.filter((i) => i.date === data.week.today).length : 0;

  return (
    <Card className={cn("min-w-0", className)}>
      {/* Wraps instead of overflowing when the card sits in a half-width column. */}
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-x-3 gap-y-1 space-y-0">
        <CardTitle className="flex min-w-0 flex-wrap items-center gap-2 text-base">
          <CalendarDays className="size-4" />
          Coming up this week
          {todayCount > 0 && (
            <Badge className="text-[10px]">{todayCount} today</Badge>
          )}
        </CardTitle>
        <div className="flex shrink-0 items-center gap-3">
          {data && <span className="text-xs text-muted-foreground">{remainingRange(data.week)}</span>}
          <Link href="/calendar" className="text-xs text-primary hover:underline">
            Calendar
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {data === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing else coming up this week.</p>
        ) : (
          <ul className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
            {items.map((item) => {
              const { weekday, date } = dayLabel(item.date);
              const isToday = item.date === data.week.today;
              const kind = KIND[item.kind];
              return (
                <li
                  key={item.id}
                  // A border (inside the box), not a ring/shadow: the list scrolls, and
                  // overflow clips anything drawn outside a row's edges.
                  className={cn(
                    "flex min-w-0 items-center gap-3 rounded-md border border-transparent px-2 py-2 text-sm",
                    isToday && "border-primary/30 bg-primary/10",
                  )}
                >
                  <div className="flex w-14 shrink-0 flex-col leading-tight">
                    <span className={cn("text-xs font-semibold uppercase", isToday && "text-primary")}>
                      {isToday ? "Today" : weekday}
                    </span>
                    <span className="text-xs text-muted-foreground">{date}</span>
                  </div>
                  <span aria-hidden className="shrink-0">
                    {kind.emoji}
                  </span>
                  <span className={cn("min-w-0 flex-1 truncate", isToday && "font-medium")} title={item.title}>
                    <span className="sr-only">{kind.label}: </span>
                    {item.title}
                  </span>
                  {item.at && (
                    <span className="shrink-0 text-xs text-muted-foreground">{formatTime(item.at)}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
