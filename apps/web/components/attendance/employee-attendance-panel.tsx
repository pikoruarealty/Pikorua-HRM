"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AttendanceCalendar,
  AttendanceLegend,
  LOCATION_STYLE,
  formatHours,
  type CalendarDay,
} from "@/components/attendance/attendance-calendar";
import { cn } from "@/lib/utils";

type Split = { office: number; wfh: number };

type Summary = {
  late_count: number;
  half_day_count: number;
  unpaid_leave_count: number | null;
  approved_record_count: number;
  present_days: number;
  absent_days: number;
  half_days: number;
  paid_leave_days: number;
  unpaid_leave_days: number;
  compensation_days: number;
  holiday_days: number;
  working_days_elapsed: number;
  hours: { office: number; wfh: number; total: number };
  expected_hours: { month: number; weekly: number | null; wfhWeekly: number | null } | null;
  worked_days: Split;
  by_status: { present: Split; half_day: Split; compensation: Split };
  pending: { days: number; hours: number };
  days: CalendarDay[];
  notes: { late_tracking_unavailable?: string; unpaid_leave_unavailable?: string };
};

async function getJson(res: Response) {
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data;
}

function currentMonth() {
  // IST, like every other date in the app — the server's own clock may be UTC.
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 7);
}

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

type WfhPlan =
  | { enabled: false }
  | {
      enabled: true;
      expectedPerWeek: number;
      thisWeek: { worked: number; target: number };
      balance: {
        bankedHours: number;
        bankedUntil: string | null;
        owedHours: number;
        owedUntil: string | null;
        unmetHours: number;
      };
    };

function shortDate(key: string) {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function EmployeeAttendancePanel({
  employeeId,
  title = "Attendance",
  canEditDays = false,
}: {
  employeeId: string;
  title?: string;
  /** The employee's own view: lets them switch an automatic weekly off to unpaid
   *  leave (and back) from the calendar. */
  canEditDays?: boolean;
}) {
  const [month, setMonth] = useState(currentMonth);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<CalendarDay | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [wfh, setWfh] = useState<WfhPlan | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/attendance/${employeeId}/wfh-hours`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled && j.data) setWfh(j.data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [employeeId, reloadKey]);

  // Switching an automatic weekly off to unpaid leave (or back) — the employee's
  // own call, no approval (POST/DELETE /attendance/unpaid-day).
  async function switchDay(day: CalendarDay) {
    setActionBusy(true);
    setError(null);
    try {
      await getJson(
        await fetch("/api/v1/attendance/unpaid-day", {
          method: day.note === "declared_unpaid" ? "DELETE" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: day.date }),
        }),
      );
      setSelected(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't change that day.");
    } finally {
      setActionBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [year, mo] = month.split("-").map(Number);
        const data = await getJson(
          await fetch(`/api/v1/attendance/${employeeId}/summary?month=${mo}&year=${year}`),
        );
        if (!cancelled) setSummary(data);
      } catch (e) {
        if (!cancelled) {
          setSummary(null);
          setError(e instanceof Error ? e.message : "Failed to load attendance.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [employeeId, month, reloadKey]);

  const [year, mo] = month.split("-").map(Number);
  const atCurrentMonth = month >= currentMonth();

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0 px-4 pb-3 pt-4 sm:p-6">
        <CardTitle>{title}</CardTitle>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9"
            aria-label="Previous month"
            onClick={() => setMonth((m) => shiftMonth(m, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[8.5rem] text-center text-sm font-medium">{monthLabel(month)}</span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9"
            aria-label="Next month"
            disabled={atCurrentMonth}
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-3 pb-4 sm:gap-5 sm:px-6 sm:pb-6">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {loading && !summary ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : summary ? (
          <div className={cn("flex flex-col gap-4 transition-opacity sm:gap-5", loading && "opacity-60")}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3 lg:grid-cols-8">
              <Stat label="Present" value={summary.present_days} split={summary.by_status.present} />
              <Stat label="Half-day" value={summary.half_days} split={summary.by_status.half_day} />
              <Stat label="Absent" value={summary.absent_days} alert={summary.absent_days > 0} />
              <Stat label="Late (approved)" value={summary.late_count} />
              <Stat label="Paid leave" value={summary.paid_leave_days} />
              <Stat label="Unpaid leave" value={summary.unpaid_leave_days} />
              <Stat label="Compensation" value={summary.compensation_days} split={summary.by_status.compensation} />
              <Stat label="Holidays" value={summary.holiday_days} />
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
              <HoursTile
                label="Hours in office"
                value={summary.hours.office}
                dot={LOCATION_STYLE.office.dot}
                textClass={LOCATION_STYLE.office.text}
                days={summary.worked_days.office}
              />
              <HoursTile
                label="Hours from home"
                value={summary.hours.wfh}
                dot={LOCATION_STYLE.wfh.dot}
                textClass={LOCATION_STYLE.wfh.text}
                days={summary.worked_days.wfh}
                hint={
                  summary.expected_hours?.wfhWeekly ? `target ${summary.expected_hours.wfhWeekly}h / week` : undefined
                }
              />
              <HoursTile
                className="col-span-2 sm:col-span-1"
                label="Total hours worked"
                value={summary.hours.total}
                days={summary.worked_days.office + summary.worked_days.wfh}
                hint={summary.expected_hours ? `of ${summary.expected_hours.month}h expected` : undefined}
              />
            </div>

            {wfh?.enabled && <WfhLine plan={wfh} />}

            <div className="flex flex-col gap-3">
              <AttendanceCalendar
                month={mo}
                year={year}
                days={summary.days}
                selectedDate={canEditDays ? selected?.date : null}
                onSelect={canEditDays ? (d) => setSelected((s) => (s?.date === d.date ? null : d)) : undefined}
              />
              {canEditDays && selected && (selected.note === "declared_unpaid" || selected.note === "auto_off" || selected.note === "provisional_off") && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                  <span>
                    <span className="font-medium">{shortDate(selected.date)}</span>
                    <span className="text-muted-foreground">
                      {" · "}
                      {selected.note === "declared_unpaid"
                        ? "unpaid leave (switched by you)"
                        : selected.note === "provisional_off"
                          ? "weekly off (pending)"
                          : "automatic weekly off"}
                    </span>
                  </span>
                  <Button size="sm" variant="outline" disabled={actionBusy} onClick={() => switchDay(selected)}>
                    {actionBusy
                      ? "Saving…"
                      : selected.note === "declared_unpaid"
                        ? "Back to weekly off"
                        : "Switch to unpaid leave"}
                  </Button>
                </div>
              )}
              <AttendanceLegend />
            </div>

            {(summary.pending.days > 0 ||
              summary.notes.unpaid_leave_unavailable ||
              summary.notes.late_tracking_unavailable) && (
              <p className="text-xs text-muted-foreground">
                {summary.pending.days > 0 && (
                  <>
                    {summary.pending.days} day{summary.pending.days === 1 ? "" : "s"} (
                    {formatHours(summary.pending.hours)}) awaiting approval — not in the totals yet.{" "}
                  </>
                )}
                {summary.notes.unpaid_leave_unavailable && (
                  <>Unpaid leave isn&apos;t available yet ({summary.notes.unpaid_leave_unavailable}). </>
                )}
                {summary.notes.late_tracking_unavailable}
              </p>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  split,
  alert,
}: {
  label: string;
  value: number | string;
  /** Where the counted days were worked — only shown when there's something to split. */
  split?: Split;
  alert?: boolean;
}) {
  const showSplit = split && split.office + split.wfh > 0;
  return (
    <div className="rounded-lg border p-2.5 sm:p-3">
      <div className={cn("text-xl font-semibold tabular-nums sm:text-2xl", alert && "text-destructive")}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {showSplit && (
        <div className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className={cn("h-1.5 w-1.5 rounded-full", LOCATION_STYLE.office.dot)} />
            {split.office} office
          </span>
          <span className="flex items-center gap-1">
            <span className={cn("h-1.5 w-1.5 rounded-full", LOCATION_STYLE.wfh.dot)} />
            {split.wfh} WFH
          </span>
        </div>
      )}
    </div>
  );
}

function HoursTile({
  label,
  value,
  days,
  dot,
  textClass,
  hint,
  className,
}: {
  className?: string;
  label: string;
  value: number;
  days: number;
  dot?: string;
  textClass?: string;
  /** Small muted extra (expected hours / weekly target). */
  hint?: string;
}) {
  return (
    <div className={cn("rounded-lg border p-3", className)}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {dot && <span className={cn("h-2 w-2 rounded-full", dot)} />}
        {label}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className={cn("text-xl font-semibold tabular-nums sm:text-2xl", textClass)}>{formatHours(value)}</span>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">
        across {days} day{days === 1 ? "" : "s"}
      </div>
    </div>
  );
}

/** One quiet line: this week's WFH hours against the target, plus any banked
 *  (worked ahead) or owed (still to make up) hours with the date they lapse. */
function WfhLine({ plan }: { plan: Extract<WfhPlan, { enabled: true }> }) {
  const b = plan.balance;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className={cn("h-2 w-2 rounded-full", LOCATION_STYLE.wfh.dot)} />
        WFH this week{" "}
        <span className="font-medium text-foreground">
          {formatHours(plan.thisWeek.worked)} / {formatHours(plan.thisWeek.target)}
        </span>
      </span>
      {b.bankedHours > 0 && (
        <span>
          +{formatHours(b.bankedHours)} ahead{b.bankedUntil ? ` · until ${shortDate(b.bankedUntil)}` : ""}
        </span>
      )}
      {b.owedHours > 0 && (
        <span className="text-warning">
          {formatHours(b.owedHours)} to make up{b.owedUntil ? ` by ${shortDate(b.owedUntil)}` : ""}
        </span>
      )}
      {b.unmetHours > 0 && <span className="text-destructive">{formatHours(b.unmetHours)} missed</span>}
    </div>
  );
}
