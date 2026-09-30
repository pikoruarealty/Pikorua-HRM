"use client";

import { useEffect, useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/format-date";

// Month calendar for one employee (2026-09-30). Replaces the flat list of dates:
// a list can't show a month's shape, and it sat under tiles that didn't add up
// to it. Every cell here comes from the same per-day classification the tiles
// are counted from (GET /attendance/:id/summary -> days), so the two agree.
//
// Colour carries *where* people worked — green for in the office, blue for
// work-from-home — and the label under the date carries *what kind of day* it
// was, so nothing relies on colour alone.

export type CalendarDayStatus =
  | "present"
  | "half_day"
  | "compensation"
  | "absent"
  | "paid_leave"
  | "unpaid_leave"
  | "holiday"
  | "weekly_off"
  | "no_record"
  | "pending";

export type CalendarLocation = "office" | "wfh" | "mixed";

export type CalendarDay = {
  date: string; // YYYY-MM-DD
  status: CalendarDayStatus | null;
  pending: boolean;
  location: CalendarLocation | null;
  hours: number | null;
  officeHours: number;
  wfhHours: number;
  clockIn: string | null;
  clockOut: string | null;
  sessionCount: number;
  isHalfDay: boolean;
  isCompensation: boolean;
  /** Why the day is what it is, where not obvious (automatic weekly off etc.). */
  note?: "auto_off" | "provisional_off" | "declared_unpaid" | null;
};

/** True on a device with no hover (phones/tablets, and browser device
 *  emulation) or a phone-width window: there, hover tooltips can't work. */
function useTouchOnly(): boolean {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(hover: none), (max-width: 767px)");
    const update = () => setTouch(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return touch;
}

const WEEKDAYS =["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Shared by the calendar, its legend and the stat tiles so a colour means one thing. */
export const LOCATION_STYLE = {
  office: {
    label: "In office",
    cell: "border-emerald-500/30 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
    dot: "bg-emerald-500",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  wfh: {
    label: "Work from home",
    cell: "border-sky-500/30 bg-sky-500/15 text-sky-800 dark:text-sky-200",
    dot: "bg-sky-500",
    text: "text-sky-700 dark:text-sky-300",
  },
  mixed: {
    label: "Office + WFH",
    cell: "border-teal-500/30 bg-gradient-to-br from-emerald-500/20 to-sky-500/20 text-teal-800 dark:text-teal-200",
    dot: "bg-teal-500",
    text: "text-teal-700 dark:text-teal-300",
  },
} as const;

type StatusStyle = { label: string; short: string; cell: string };

const STATUS_STYLE: Record<Exclude<CalendarDayStatus, "present">, StatusStyle> = {
  half_day: {
    label: "Half day",
    short: "Half",
    cell: "border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-200",
  },
  compensation: {
    label: "Compensation day",
    short: "Comp",
    cell: "border-violet-500/40 bg-violet-500/15 text-violet-800 dark:text-violet-200",
  },
  absent: {
    label: "Absent",
    short: "Absent",
    cell: "border-destructive/35 bg-destructive/12 text-destructive",
  },
  paid_leave: {
    label: "Paid leave",
    short: "Leave",
    cell: "border-pink-500/35 bg-pink-500/12 text-pink-800 dark:text-pink-200",
  },
  unpaid_leave: {
    label: "Unpaid leave",
    short: "Unpaid",
    cell: "border-orange-500/40 bg-orange-500/12 text-orange-800 dark:text-orange-200",
  },
  holiday: {
    label: "Holiday",
    short: "Holiday",
    cell: "border-slate-400/40 bg-slate-400/15 text-slate-700 dark:text-slate-200",
  },
  weekly_off: {
    label: "Weekly off",
    short: "Off",
    cell: "border-border bg-muted/40 text-muted-foreground",
  },
  no_record: {
    label: "No attendance recorded",
    short: "—",
    cell: "border-border bg-transparent text-muted-foreground",
  },
  pending: {
    label: "Awaiting approval",
    short: "Pending",
    cell: "border-dashed border-foreground/30 bg-transparent text-foreground",
  },
};

/** "8h", "7h 30m", "45m" — worked time reads better than 7.5. */
export function formatHours(h: number | null | undefined): string {
  if (h == null) return "—";
  const minutes = Math.round(h * 60);
  if (minutes <= 0) return "0h";
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  if (hh === 0) return `${mm}m`;
  return mm === 0 ? `${hh}h` : `${hh}h ${mm}m`;
}

function dayNumber(date: string) {
  return Number(date.slice(8, 10));
}

function longDate(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function istToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** The cell's look. Present days take the colour of where they were worked;
 *  everything else takes its status colour, with a location dot on worked days. */
function cellClass(day: CalendarDay): string {
  if (day.status === null) return "border-transparent text-muted-foreground/40";
  if (day.status === "present") return LOCATION_STYLE[day.location ?? "office"].cell;
  return STATUS_STYLE[day.status].cell;
}

/** "7.5h" / "8h" / "45m" — the shortest form that still reads, for phone-width
 *  cells where "7h 30m" got cut to "7h …". */
function formatHoursTiny(h: number | null | undefined): string {
  if (h == null) return "—";
  const minutes = Math.round(h * 60);
  if (minutes <= 0) return "0h";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round((minutes / 60) * 10) / 10}h`;
}

/** Status words short enough for a ~40px phone cell (legend + tooltip spell them out). */
const TINY_LABEL: Record<Exclude<CalendarDayStatus, "present">, string> = {
  half_day: "Half",
  compensation: "Comp",
  absent: "Abs",
  paid_leave: "Leave",
  unpaid_leave: "Unpd",
  holiday: "Hol",
  weekly_off: "Off",
  no_record: "—",
  pending: "Pend",
};

/** `full` for ≥ sm, `tiny` for phones — the cell shows one or the other. */
function cellLabel(day: CalendarDay): { full: string; tiny: string } {
  if (day.status === null) return { full: "", tiny: "" };
  if (day.status === "present") return { full: formatHours(day.hours), tiny: formatHoursTiny(day.hours) };
  if (day.status === "half_day" || day.status === "compensation" || day.status === "pending") {
    if (day.hours != null) return { full: formatHours(day.hours), tiny: formatHoursTiny(day.hours) };
    return { full: STATUS_STYLE[day.status].short, tiny: TINY_LABEL[day.status] };
  }
  return { full: STATUS_STYLE[day.status].short, tiny: TINY_LABEL[day.status] };
}

function DayTooltip({ day }: { day: CalendarDay }) {
  const status = day.status;
  const statusLabel =
    status === "present"
      ? "Present"
      : status === null
        ? ""
        : STATUS_STYLE[status].label;
  const worked = day.clockIn !== null;
  const loc = day.location ? LOCATION_STYLE[day.location] : null;

  return (
    <div className="flex min-w-[11rem] flex-col gap-1.5">
      <div className="flex items-center justify-between gap-4">
        <span className="font-semibold">{longDate(day.date)}</span>
        <span className="text-[11px] font-medium text-muted-foreground">{statusLabel}</span>
      </div>
      {worked ? (
        <div className="flex flex-col gap-1 text-muted-foreground">
          {loc && (
            <span className="flex items-center gap-1.5">
              <span className={cn("h-2 w-2 rounded-full", loc.dot)} />
              {loc.label}
            </span>
          )}
          <span className="tabular-nums">
            {formatTime(day.clockIn)} → {day.clockOut ? formatTime(day.clockOut) : "still open"}
          </span>
          {day.hours != null && (
            <span className="font-medium text-foreground">
              {formatHours(day.hours)} worked
              {day.location === "mixed" && (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  ({formatHours(day.officeHours)} office · {formatHours(day.wfhHours)} WFH)
                </span>
              )}
            </span>
          )}
          {day.sessionCount > 1 && <span>{day.sessionCount} sessions (breaks not counted)</span>}
          {day.isCompensation && status !== "compensation" && <span>Marked as a compensation day</span>}
          {day.pending && <span>Not approved yet — not counted in the totals</span>}
        </div>
      ) : (
        <p className="text-muted-foreground">
          {day.note === "declared_unpaid"
            ? "Switched to unpaid leave."
            : day.note === "auto_off"
              ? "Automatic weekly off."
              : day.note === "provisional_off"
                ? "Weekly off for now — may change once the week ends."
                : status === "absent"
            ? "No attendance recorded."
            : status === "weekly_off"
              ? "Day off."
              : status === "holiday"
                ? "Company holiday."
                : status === "paid_leave"
                  ? "Approved paid leave."
                  : status === "unpaid_leave"
                    ? "Approved unpaid leave."
                    : "Nothing recorded."}
        </p>
      )}
    </div>
  );
}

/** Where a day's tooltip sits so it stays inside the card at the edges. */
function alignFor(col: number): "start" | "center" | "end" {
  if (col <= 1) return "start";
  if (col >= 5) return "end";
  return "center";
}

export function AttendanceCalendar({
  month,
  year,
  days,
  selectedDate,
  onSelect,
}: {
  month: number;
  year: number;
  days: CalendarDay[];
  /** When set, tapping a day selects it (the panel shows actions for it). */
  selectedDate?: string | null;
  onSelect?: (day: CalendarDay) => void;
}) {
  const today = istToday();
  const touch = useTouchOnly();
  const [detailDate, setDetailDate] = useState<string | null>(null);
  const detailDay = detailDate ? (days.find((d) => d.date === detailDate) ?? null) : null;
  // A month change replaces `days`; drop a selection that's no longer in it.
  useEffect(() => {
    setDetailDate((cur) => (cur && days.some((d) => d.date === cur) ? cur : null));
  }, [days]);
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const cells: (CalendarDay | null)[] = [...Array<null>(firstWeekday).fill(null), ...days];

  return (
    <TooltipProvider delayDuration={80} skipDelayDuration={200}>
      <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="pb-1 text-center text-[11px] font-medium uppercase tracking-normal text-muted-foreground sm:tracking-wider"
          >
            {/* One letter on a phone (seven 3-letter headings ran into each other). */}
            <span className="sm:hidden" aria-hidden>
              {d[0]}
            </span>
            <span className="hidden sm:inline">{d}</span>
            <span className="sr-only sm:hidden">{d}</span>
          </div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={`blank-${i}`} />;
          const isToday = day.date === today;
          const evaluated = day.status !== null;
          const face = (
            <div
              className={cn(
                "flex h-full min-h-[3.75rem] flex-col justify-between rounded-lg border p-1.5 text-left sm:min-h-[4.75rem] sm:p-2",
                cellClass(day),
                isToday && "ring-2 ring-brand ring-offset-1 ring-offset-card",
                (selectedDate === day.date || (touch && detailDate === day.date)) &&
                  "ring-2 ring-foreground/50 ring-offset-1 ring-offset-card",
              )}
            >
              <div className="flex items-start justify-between">
                <span className="text-xs font-semibold tabular-nums sm:text-sm">{dayNumber(day.date)}</span>
                {day.location &&
                  (day.status === "half_day" || day.status === "compensation" || day.status === "pending") && (
                    <span
                      className={cn("mt-0.5 h-2 w-2 rounded-full", LOCATION_STYLE[day.location].dot)}
                      aria-hidden
                    />
                  )}
              </div>
              <span className="truncate text-[10px] font-medium leading-tight sm:text-xs">
                <span className="sm:hidden">{cellLabel(day).tiny}</span>
                <span className="hidden sm:inline">{cellLabel(day).full}</span>
              </span>
            </div>
          );

          if (!evaluated) {
            return (
              <div key={day.date} aria-label={`${longDate(day.date)}: not counted`}>
                {face}
              </div>
            );
          }

          const button = (
            <button
              type="button"
              onClick={() => {
                onSelect?.(day);
                // Touch: tap toggles the details panel below the grid.
                if (touch) setDetailDate((cur) => (cur === day.date ? null : day.date));
              }}
              className="w-full rounded-lg text-left outline-none transition-transform hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`${longDate(day.date)}: ${
                day.status === "present" ? "Present" : STATUS_STYLE[day.status as Exclude<CalendarDayStatus, "present">].label
              }`}
            >
              {face}
            </button>
          );

          // On a touch screen there is no hover: a hover tooltip flashes open on
          // the tap and closes the instant the finger lifts. There the details
          // open on tap, in a panel under the grid, and stay until tapped again.
          if (touch) return <div key={day.date}>{button}</div>;

          return (
            <Tooltip key={day.date}>
              <TooltipTrigger asChild>{button}</TooltipTrigger>
              <TooltipContent side="top" align={alignFor((firstWeekday + dayNumber(day.date) - 1) % 7)} className="p-3 text-xs">
                <DayTooltip day={day} />
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      {touch && detailDay && (
        <div className="mt-3 rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-sm">
          <DayTooltip day={detailDay} />
        </div>
      )}
    </TooltipProvider>
  );
}

const LEGEND: { key: string; label: string; swatch: string }[] = [
  { key: "office", label: "In office", swatch: LOCATION_STYLE.office.cell },
  { key: "wfh", label: "Work from home", swatch: LOCATION_STYLE.wfh.cell },
  { key: "half", label: "Half day", swatch: STATUS_STYLE.half_day.cell },
  { key: "comp", label: "Compensation", swatch: STATUS_STYLE.compensation.cell },
  { key: "absent", label: "Absent", swatch: STATUS_STYLE.absent.cell },
  { key: "paid", label: "Paid leave", swatch: STATUS_STYLE.paid_leave.cell },
  { key: "unpaid", label: "Unpaid leave", swatch: STATUS_STYLE.unpaid_leave.cell },
  { key: "holiday", label: "Holiday", swatch: STATUS_STYLE.holiday.cell },
  { key: "off", label: "Weekly off", swatch: STATUS_STYLE.weekly_off.cell },
  { key: "pending", label: "Pending approval", swatch: STATUS_STYLE.pending.cell },
];

export function AttendanceLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {LEGEND.map((l) => (
        <li key={l.key} className="flex items-center gap-1.5">
          <span className={cn("h-3 w-3 rounded border", l.swatch)} aria-hidden />
          {l.label}
        </li>
      ))}
    </ul>
  );
}
