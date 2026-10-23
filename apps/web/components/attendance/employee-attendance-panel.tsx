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

type BalanceEligibleDay = {
  date: string;
  kind: "absence" | "unpaid_leave";
  location: "office" | "wfh";
  pending: boolean;
};

type BalanceCredit = {
  id: string;
  earnedDate: string;
  expiresAt: string;
  workLocation: "office" | "wfh";
  status: "available" | "covering" | "used" | "expired";
  coversDate?: string;
  coversKind?: "absence" | "unpaid_leave";
  applied?: boolean;
};

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
  /** A part-timer's over-quota days. Days worked in advance are in present_days. */
  compensation_days: number;
  /** Days worked in advance (weekly off / flagged) — counted in present_days. */
  advance_days: number;
  /** Absent / unpaid days covered by an approved balance day — counted in paid_leave_days. */
  balance_days: number;
  compensation_balance: { availableCount: number; credits: BalanceCredit[]; eligibleDays: BalanceEligibleDay[] };
  holiday_days: number;
  working_days_elapsed: number;
  /** Days that count toward pay: present + ½ × half-days + paid leave + holidays + compensation. */
  payable_days: number;
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
      /** Hours of WFH per week that count (Admin-set cap). */
      capPerWeek: number;
      /** `worked` = counted hours (after the cap and any Admin approval); `actual` = really worked. */
      thisWeek: WfhWeekRow;
      recent: WfhWeekRow[];
      balance: {
        bankedHours: number;
        bankedFromOfficeHours: number;
        bankedUntil: string | null;
        owedHours: number;
        owedUntil: string | null;
        unmetHours: number;
      };
    };

type WfhWeekRow = {
  weekStart: string;
  worked: number;
  actual: number;
  cap: number;
  approvedExtra: number;
  target: number;
};

function shortDate(key: string) {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function EmployeeAttendancePanel({
  employeeId,
  title = "Attendance",
  canEditDays = false,
  canMarkPaidLeave = false,
  canApproveWfhHours = false,
}: {
  employeeId: string;
  title?: string;
  /** The employee's own view: lets them switch an automatic weekly off to unpaid
   *  leave (and back) from the calendar. */
  canEditDays?: boolean;
  /** Admin viewing someone else: lets them turn an absent / unpaid-leave day into
   *  paid leave (POST /attendance/mark-paid-leave). */
  canMarkPaidLeave?: boolean;
  /** Admin: approve extra WFH hours over the weekly cap (PUT .../wfh-hours/extra). */
  canApproveWfhHours?: boolean;
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

  // Admin: absent / unpaid-leave day -> paid leave (audited, reason required).
  const [paidReason, setPaidReason] = useState("");
  const [paidHalf, setPaidHalf] = useState(false);
  const [paidType, setPaidType] = useState<"leave_casual" | "leave_sick">("leave_casual");
  const [paidNotice, setPaidNotice] = useState<string | null>(null);

  async function markPaidLeave(day: CalendarDay) {
    setActionBusy(true);
    setError(null);
    setPaidNotice(null);
    try {
      const data = await getJson(
        await fetch("/api/v1/attendance/mark-paid-leave", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employee_id: employeeId,
            date: day.date,
            type: paidType,
            half_day: day.status === "absent" && paidHalf ? true : undefined,
            reason: paidReason.trim(),
          }),
        }),
      );
      setSelected(null);
      setPaidReason("");
      setPaidHalf(false);
      setPaidNotice(
        `${shortDate(day.date)} is now paid leave.` +
          (data?.exceeds_monthly_cap
            ? ` Note: that is ${data.monthly_paid_leave_used} paid days this month, over the ${data.monthly_paid_leave_cap}-day allowance.`
            : ""),
      );
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't mark that day as paid leave.");
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
              <Stat
                label="Present"
                value={summary.present_days}
                split={summary.by_status.present}
                hint={summary.advance_days > 0 ? `incl. ${summary.advance_days} worked in advance` : undefined}
              />
              <Stat label="Half-day" value={summary.half_days} split={summary.by_status.half_day} />
              <Stat label="Absent" value={summary.absent_days} alert={summary.absent_days > 0} />
              <Stat label="Late (approved)" value={summary.late_count} />
              <Stat
                label="Paid leave"
                value={summary.paid_leave_days}
                hint={summary.balance_days > 0 ? `incl. ${summary.balance_days} balance day${summary.balance_days === 1 ? "" : "s"}` : undefined}
              />
              <Stat label="Unpaid leave" value={summary.unpaid_leave_days} />
              <Stat label="Compensation" value={summary.compensation_days} split={summary.by_status.compensation} />
              <Stat label="Holidays" value={summary.holiday_days} />
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
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
                label="Total hours worked"
                value={summary.hours.total}
                days={summary.worked_days.office + summary.worked_days.wfh}
                hint={summary.expected_hours ? `of ${summary.expected_hours.month}h expected` : undefined}
              />
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Payable days</div>
                <div className="mt-1 text-xl font-semibold tabular-nums sm:text-2xl">{summary.payable_days}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  present + ½ half-days + leave + holidays + comp
                </div>
              </div>
            </div>

            {wfh?.enabled && (
              <WfhLine
                plan={wfh}
                employeeId={employeeId}
                canApprove={canApproveWfhHours}
                onChanged={() => setReloadKey((k) => k + 1)}
              />
            )}

            <BalanceDays
              balance={summary.compensation_balance}
              canRequest={canEditDays}
              onRequested={() => setReloadKey((k) => k + 1)}
            />

            <div className="flex flex-col gap-3">
              <AttendanceCalendar
                month={mo}
                year={year}
                days={summary.days}
                selectedDate={canEditDays || canMarkPaidLeave ? selected?.date : null}
                onSelect={
                  canEditDays || canMarkPaidLeave
                    ? (d) => setSelected((s) => (s?.date === d.date ? null : d))
                    : undefined
                }
              />
              {paidNotice && <p className="text-xs text-muted-foreground">{paidNotice}</p>}
              {canMarkPaidLeave && selected && (selected.status === "absent" || selected.status === "unpaid_leave") && (
                <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                  <span>
                    <span className="font-medium">{shortDate(selected.date)}</span>
                    <span className="text-muted-foreground">
                      {" · "}
                      {selected.status === "absent" ? "absent" : "unpaid leave"} — mark as paid leave?
                    </span>
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      className="flex h-9 min-w-[12rem] flex-1 rounded-md border border-input bg-background px-3 py-1 text-sm"
                      placeholder="Reason (audited)"
                      value={paidReason}
                      onChange={(e) => setPaidReason(e.target.value)}
                      aria-label="Reason for marking paid leave"
                    />
                    <select
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                      value={paidType}
                      onChange={(e) => setPaidType(e.target.value as "leave_casual" | "leave_sick")}
                      aria-label="Paid leave type"
                    >
                      <option value="leave_casual">Casual</option>
                      <option value="leave_sick">Sick</option>
                    </select>
                    {selected.status === "absent" && (
                      <label className="flex h-9 cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="size-4"
                          checked={paidHalf}
                          onChange={(e) => setPaidHalf(e.target.checked)}
                        />
                        Half day only
                      </label>
                    )}
                    <Button
                      size="sm"
                      disabled={actionBusy || paidReason.trim().length < 3}
                      onClick={() => markPaidLeave(selected)}
                    >
                      {actionBusy ? "Saving…" : "Mark as paid leave"}
                    </Button>
                  </div>
                </div>
              )}
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
  hint,
}: {
  label: string;
  value: number | string;
  /** Where the counted days were worked — only shown when there's something to split. */
  split?: Split;
  alert?: boolean;
  /** Small muted extra under the label. */
  hint?: string;
}) {
  const showSplit = split && split.office + split.wfh > 0;
  return (
    <div className="rounded-lg border p-2.5 sm:p-3">
      <div className={cn("text-xl font-semibold tabular-nums sm:text-2xl", alert && "text-destructive")}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
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

/** WFH hours against the target. Only `capPerWeek` hours of a week count, so the
 *  line shows counted vs actually worked; any banked (worked ahead) or owed (still
 *  to make up) hours carry the date they lapse. An Admin can count more of what was
 *  really worked from the rows below. */
function WfhLine({
  plan,
  employeeId,
  canApprove,
  onChanged,
}: {
  plan: Extract<WfhPlan, { enabled: true }>;
  employeeId: string;
  canApprove: boolean;
  onChanged: () => void;
}) {
  const b = plan.balance;
  const t = plan.thisWeek;
  // Weeks where the cap held something back (or an Admin already released some).
  const capped = [t, ...plan.recent].filter((w) => w.actual > w.cap || w.approvedExtra > 0);
  return (
    <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-1.5">
          <span className={cn("h-2 w-2 rounded-full", LOCATION_STYLE.wfh.dot)} />
          WFH this week{" "}
          <span className="font-medium text-foreground">
            {formatHours(t.worked)} / {formatHours(t.target)}
          </span>
          {t.actual > t.worked && (
            <span>
              ({formatHours(t.actual)} worked, {formatHours(plan.capPerWeek)} counts)
            </span>
          )}
        </span>
        {b.bankedHours > 0 && (
          <span>
            +{formatHours(b.bankedHours)} ahead
            {b.bankedFromOfficeHours > 0 ? ` (${formatHours(b.bankedFromOfficeHours)} from office time)` : ""}
            {b.bankedUntil ? ` · until ${shortDate(b.bankedUntil)}` : ""}
          </span>
        )}
        {b.owedHours > 0 && (
          <span className="text-warning">
            {formatHours(b.owedHours)} to make up{b.owedUntil ? ` by ${shortDate(b.owedUntil)}` : ""}
          </span>
        )}
        {b.unmetHours > 0 && <span className="text-destructive">{formatHours(b.unmetHours)} missed</span>}
      </div>
      {capped.map((w) => (
        <WfhCapRow key={w.weekStart} week={w} employeeId={employeeId} canApprove={canApprove} onChanged={onChanged} />
      ))}
    </div>
  );
}

function WfhCapRow({
  week,
  employeeId,
  canApprove,
  onChanged,
}: {
  week: WfhWeekRow;
  employeeId: string;
  canApprove: boolean;
  onChanged: () => void;
}) {
  const headroom = Math.max(0, Math.round((week.actual - week.cap) * 100) / 100);
  const [extra, setExtra] = useState(String(week.approvedExtra > 0 ? week.approvedExtra : headroom));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(hours: number) {
    setBusy(true);
    setErr(null);
    try {
      await getJson(
        await fetch(`/api/v1/attendance/${employeeId}/wfh-hours/extra`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ week_start: week.weekStart, extra_hours: hours }),
        }),
      );
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-muted/30 px-2.5 py-1.5">
      <span>
        Week of <span className="font-medium text-foreground">{shortDate(week.weekStart)}</span>:{" "}
        <span className="font-medium text-foreground">{formatHours(week.actual)}</span> worked from home,{" "}
        <span className="font-medium text-foreground">{formatHours(week.worked)}</span> counted
        {week.approvedExtra > 0 && <> (incl. {formatHours(week.approvedExtra)} approved by Admin)</>}
      </span>
      {canApprove && headroom > 0 && (
        <span className="flex items-center gap-1.5">
          <input
            type="number"
            min={0}
            max={headroom}
            step={0.5}
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            aria-label="Extra WFH hours to count"
            className="h-7 w-16 rounded border bg-background px-1.5 text-foreground"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            disabled={busy || !(Number(extra) >= 0) || Number(extra) > headroom}
            onClick={() => save(Number(extra))}
          >
            {busy ? "Saving…" : week.approvedExtra > 0 ? "Update" : "Count extra"}
          </Button>
          {week.approvedExtra > 0 && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy} onClick={() => save(0)}>
              Remove
            </Button>
          )}
        </span>
      )}
      {err && <span className="w-full text-destructive">{err}</span>}
    </div>
  );
}

const KIND_LABEL = { absence: "an absent day", unpaid_leave: "an unpaid-leave day" } as const;

/** Balance days: one per day worked in advance, usable against an absent or
 *  unpaid-leave day for 60 days. The employee asks to use one on a specific day;
 *  Admin/HR approve it in Requests, and only then does the day count as covered
 *  (shown as "Balance" on the calendar, inside Paid leave in the tiles). Office-
 *  earned days cover any day; a day earned working from home only covers a day
 *  that was itself a WFH day. */
function BalanceDays({
  balance,
  canRequest,
  onRequested,
}: {
  balance: { availableCount: number; credits: BalanceCredit[]; eligibleDays: BalanceEligibleDay[] };
  canRequest: boolean;
  onRequested: () => void;
}) {
  const [day, setDay] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (balance.credits.length === 0) return null;
  const open = balance.credits.filter((c) => c.status === "available" || c.status === "covering");
  const past = balance.credits.filter((c) => c.status === "used" || c.status === "expired").slice(0, 4);
  const requestable = balance.eligibleDays.filter((d) => !d.pending);
  const waiting = balance.eligibleDays.filter((d) => d.pending);

  async function request() {
    if (!day) return;
    setBusy(true);
    setMsg(null);
    try {
      await getJson(
        await fetch("/api/v1/requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "balance_day", dateFrom: day, dateTo: day }),
        }),
      );
      setMsg({ ok: true, text: `Requested for ${shortDate(day)} — waiting for Admin/HR to approve.` });
      setDay("");
      onRequested();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not send the request." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-medium">
          Balance days <span className="tabular-nums text-muted-foreground">· {balance.availableCount} available</span>
        </div>
        <div className="text-[11px] text-muted-foreground">
          Earned by working in advance · use within 60 days on an absent or unpaid-leave day
        </div>
      </div>
      {open.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1 text-xs">
          {open.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span
                className={cn(
                  "rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                  c.workLocation === "wfh" ? LOCATION_STYLE.wfh.text : LOCATION_STYLE.office.text,
                )}
              >
                {c.workLocation === "wfh" ? "WFH" : "Office"}
              </span>
              <span>Worked {shortDate(c.earnedDate)}</span>
              <span className="text-muted-foreground">· use by {shortDate(c.expiresAt)}</span>
              {c.status === "covering" && c.coversDate && (
                <span className="text-muted-foreground">
                  · would cover {KIND_LABEL[c.coversKind ?? "absence"]} on {shortDate(c.coversDate)}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">No unused balance days.</p>
      )}

      {waiting.length > 0 && (
        <p className="mt-2 text-xs text-warning">
          Waiting for approval: {waiting.map((d) => shortDate(d.date)).join(", ")}
        </p>
      )}
      {canRequest && requestable.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2 text-xs">
          <span className="text-muted-foreground">Use a balance day on</span>
          <select
            value={day}
            onChange={(e) => setDay(e.target.value)}
            aria-label="Day to cover with a balance day"
            className="h-8 rounded border bg-background px-2 text-foreground"
          >
            <option value="">choose a day…</option>
            {requestable.map((d) => (
              <option key={d.date} value={d.date}>
                {shortDate(d.date)} — {d.kind === "absence" ? "absent" : "unpaid leave"}
              </option>
            ))}
          </select>
          <Button size="sm" className="h-8" disabled={busy || !day} onClick={request}>
            {busy ? "Sending…" : "Request"}
          </Button>
          <span className="text-[11px] text-muted-foreground">Admin/HR approve it; then the day counts as covered.</span>
        </div>
      )}
      {msg && <p className={cn("mt-1.5 text-xs", msg.ok ? "text-muted-foreground" : "text-destructive")}>{msg.text}</p>}

      {past.length > 0 && (
        <ul className="mt-2 flex flex-col gap-0.5 border-t pt-2 text-[11px] text-muted-foreground">
          {past.map((c) => (
            <li key={c.id}>
              {shortDate(c.earnedDate)} ({c.workLocation === "wfh" ? "WFH" : "office"}) —{" "}
              {c.status === "used"
                ? `used${c.coversDate ? ` for ${shortDate(c.coversDate)}` : ""}${c.applied ? " (approved)" : ""}`
                : "expired unused (added to leave balance)"}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        An office day can only be made up by working in the office; a day owed for work-from-home can be made up either
        way, so a day earned from home only covers a WFH day.
      </p>
    </div>
  );
}
