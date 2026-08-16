"use client";

import { Fragment, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AttendanceOverviewPanel } from "@/components/attendance/attendance-overview-panel";
import { AttendanceMonthlyPanel } from "@/components/attendance/attendance-monthly-panel";
import { TeamTaskProgressPanel } from "@/components/attendance/team-task-progress-panel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronsUpDown, Search, X } from "lucide-react";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { MAX_PLAUSIBLE_SHIFT_HOURS } from "@/lib/attendance/time";

type AttendanceRecord = {
  id: string;
  employeeId: string;
  employee: { id: string; fullName: string };
  date: string;
  clockInRaw: string | null;
  clockOutRaw: string | null;
  clockInApproved: string | null;
  clockOutApproved: string | null;
  totalHours: string | null;
  isHalfDay: boolean;
  isCompensation: boolean;
  lateExempt: boolean;
  lateExemptReason: string | null;
  approvalStatus: "pending" | "approved";
  flaggedForReview: boolean;
  flagReason: string | null;
};

async function getJson(res: Response) {
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data;
}

function fmt(iso: string | null) {
  if (!iso) return "—";
  return formatDateTime(iso);
}

export function AttendanceScreen({
  canReview,
  canSeeAll,
  employeeId,
}: {
  /** Admin/HR — can edit + approve, and use the manual-record override form. */
  canReview: boolean;
  /** Admin/HR or Lead — sees more than just their own records. */
  canSeeAll: boolean;
  employeeId: string | null;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Attendance</h1>
        <p className="text-sm text-muted-foreground">
          {canReview ? "Review and approval." : "Your attendance history."} Clock in/out from{" "}
          <a href="/planning" className="underline">
            Daily Planning
          </a>
          .
        </p>
      </div>

      {canReview && <AttendanceOverviewPanel />}

      {/* Attendance Records sits right after the daily overview */}
      <AttendanceTable canReview={canReview} canSeeAll={canSeeAll} employeeId={employeeId} />

      {canReview && <AttendanceMonthlyPanel />}

      {canSeeAll && <TeamTaskProgressPanel />}

      {canReview && <ManualRecordSection />}

      {canReview && <WeeklyOffMovesSection />}
    </div>
  );
}

const PAGE_SIZE = 10;

function AttendanceTable({
  canReview,
  canSeeAll,
  employeeId,
}: {
  canReview: boolean;
  canSeeAll: boolean;
  employeeId: string | null;
}) {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Defaults to "pending" for reviewers only (Admin/HR/Lead land on the queue
  // that needs their action). An employee viewing their own history has no
  // filter UI at all, so this must stay "" for them — it used to default to
  // "pending" unconditionally, which silently hid every approved day from a
  // plain employee's own "My attendance" table (2026-08-16 bug report: showed
  // "No attendance records" despite days existing, because most of an
  // employee's own records are already approved).
  const [statusFilter, setStatusFilter] = useState<"" | "pending" | "approved">(canReview ? "pending" : "");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  async function load() {
    setLoading(true);
    setPage(0);
    try {
      const qs = canReview && statusFilter ? `?approval_status=${statusFilter}` : "";
      const data = await getJson(await fetch(`/api/v1/attendance${qs}`));
      setRecords(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load attendance.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  async function approve(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await getJson(await fetch(`/api/v1/attendance/${id}/approve`, { method: "PATCH" }));
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to approve.");
    } finally {
      setBusyId(null);
    }
  }

  async function removeRecord(id: string) {
    if (!window.confirm("Remove this incomplete attendance record? This cannot be undone.")) return;
    setRemovingId(id);
    setError(null);
    try {
      await getJson(await fetch(`/api/v1/attendance/${id}`, { method: "DELETE" }));
      setRecords((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove record.");
    } finally {
      setRemovingId(null);
    }
  }

  // Group records by date (YYYY-MM-DD) for the date-grouped view
  const grouped = records.reduce<Record<string, AttendanceRecord[]>>((acc, r) => {
    const key = r.date.slice(0, 10);
    (acc[key] ??= []).push(r);
    return acc;
  }, {});
  const dateKeys = Object.keys(grouped).sort((a, b) => b.localeCompare(a)); // newest first

  // Flatten for pagination, preserving date order
  const flatRecords = dateKeys.flatMap((d) => grouped[d]);
  const totalPages = Math.ceil(flatRecords.length / PAGE_SIZE);
  const pageRecords = flatRecords.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Re-group the current page's records by date for the section headers
  const pageGrouped = pageRecords.reduce<Record<string, AttendanceRecord[]>>((acc, r) => {
    const key = r.date.slice(0, 10);
    (acc[key] ??= []).push(r);
    return acc;
  }, {});
  const pageDateKeys = Object.keys(pageGrouped).sort((a, b) => b.localeCompare(a));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{canSeeAll ? "Attendance records" : "My attendance"}</CardTitle>
        <div className="flex items-center gap-2">
          {canReview && (
            <Select
              value={statusFilter || "__all__"}
              onValueChange={(v) => {
                setStatusFilter(v === "__all__" ? "" : (v as typeof statusFilter));
              }}
            >
              <SelectTrigger className="h-9 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : records.length === 0 ? (
          <p className="text-sm text-muted-foreground">No attendance records.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Date-grouped table */}
            {pageDateKeys.map((dateKey) => (
              <div key={dateKey}>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                  {formatDate(dateKey)}
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      {canSeeAll && <TableHead>Employee</TableHead>}
                      <TableHead>Clock in</TableHead>
                      <TableHead>Clock out</TableHead>
                      <TableHead>Hours</TableHead>
                      <TableHead>Status</TableHead>
                      {canReview && <TableHead />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageGrouped[dateKey].map((r) => {
                      const inTime = r.clockInApproved ?? r.clockInRaw;
                      const outTime = r.clockOutApproved ?? r.clockOutRaw;
                      const hasIn = Boolean(inTime);
                      const hasOut = Boolean(outTime);
                      const isComplete = hasIn && hasOut;
                      const isIncomplete = !isComplete;
                      return (
                        <Fragment key={r.id}>
                          <TableRow className={isIncomplete ? "bg-amber-500/5 dark:bg-amber-950/20" : ""}>
                            {canSeeAll && <TableCell>{r.employee.fullName}</TableCell>}
                            <TableCell>
                              {!hasIn ? (
                                <span className="inline-flex items-center rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
                                  No clock-in
                                </span>
                              ) : (
                                fmt(inTime)
                              )}
                            </TableCell>
                            <TableCell>
                              {!hasOut ? (
                                <span className="inline-flex items-center rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                                  No clock-out
                                </span>
                              ) : (
                                fmt(outTime)
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span>{r.totalHours ?? "—"}</span>
                                {r.isHalfDay && <Badge variant="secondary">Half-day</Badge>}
                                {r.isCompensation && <Badge variant="outline">Compensation</Badge>}
                                {r.lateExempt && (
                                  <Badge variant="outline" title={r.lateExemptReason ?? undefined}>
                                    Late exempt
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5">
                                <Badge variant={r.approvalStatus === "approved" ? "default" : "outline"}>
                                  {r.approvalStatus}
                                </Badge>
                                {isIncomplete && (
                                  <Badge variant="destructive" className="text-[10px] uppercase tracking-wider">
                                    Incomplete
                                  </Badge>
                                )}
                                {r.flaggedForReview && (
                                  <Badge
                                    variant="destructive"
                                    className="text-[10px] uppercase tracking-wider"
                                    title={r.flagReason ?? undefined}
                                  >
                                    Needs review
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            {canReview && (
                              <TableCell>
                                <div className="flex gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setEditingId(editingId === r.id ? null : r.id)}
                                  >
                                    {editingId === r.id ? "Close" : "Edit"}
                                  </Button>
                                  {Boolean(r.clockInApproved ?? r.clockInRaw) &&
                                    r.approvalStatus === "pending" &&
                                    !r.flaggedForReview && (
                                      <Button
                                        size="sm"
                                        disabled={busyId === r.id}
                                        onClick={() => approve(r.id)}
                                        title={!r.clockOutApproved && !r.clockOutRaw ? "Missing clock-out will be auto-set to default shift end (19:00)" : undefined}
                                      >
                                        {busyId === r.id ? "Approving…" : "Approve"}
                                      </Button>
                                    )}
                                  {/* Matches the DELETE route's actual guard exactly (not
                                      just "incomplete or pending") — it only ever accepts a
                                      true phantom record: never approved, and never punched
                                      (no raw clock-in or clock-out at all). Anything with real
                                      clock data is history payroll may depend on; use Edit to
                                      correct it instead. Showing the button more broadly than
                                      this just invites a 409 on click. */}
                                  {r.approvalStatus !== "approved" && !r.clockInRaw && !r.clockOutRaw && (
                                    <Button
                                      variant="destructive"
                                      size="sm"
                                      disabled={removingId === r.id}
                                      onClick={() => removeRecord(r.id)}
                                    >
                                      {removingId === r.id ? "Removing…" : "Remove"}
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                            )}
                          </TableRow>
                          {canReview && editingId === r.id && (
                            <TableRow>
                              <TableCell colSpan={canSeeAll ? 6 : 5}>
                                <EditRecordForm
                                  record={r}
                                  onSaved={() => {
                                    setEditingId(null);
                                    load();
                                  }}
                                />
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ))}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t pt-3">
                <p className="text-xs text-muted-foreground">
                  Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, flatRecords.length)} of {flatRecords.length} records
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function EditRecordForm({
  record,
  onSaved,
}: {
  record: AttendanceRecord;
  onSaved: () => void;
}) {
  const [clockIn, setClockIn] = useState(
    toLocalInputValue(record.clockInApproved ?? record.clockInRaw),
  );
  const [clockOut, setClockOut] = useState(
    toLocalInputValue(record.clockOutApproved ?? record.clockOutRaw),
  );
  const [isCompensation, setIsCompensation] = useState(record.isCompensation);
  const [lateExempt, setLateExempt] = useState(record.lateExempt);
  const [lateExemptReason, setLateExemptReason] = useState(record.lateExemptReason ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [longDurationError, setLongDurationError] = useState(false);

  async function save(confirmLongDuration = false) {
    setSubmitting(true);
    setError(null);
    try {
      await getJson(
        await fetch(`/api/v1/attendance/${record.id}/edit`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clock_in_approved: clockIn ? new Date(clockIn).toISOString() : null,
            clock_out_approved: clockOut ? new Date(clockOut).toISOString() : null,
            is_compensation: isCompensation,
            late_exempt: lateExempt,
            late_exempt_reason: lateExempt ? lateExemptReason || null : null,
            confirm_long_duration: confirmLongDuration || undefined,
          }),
        }),
      );
      onSaved();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save.";
      setLongDurationError(/beyond a normal shift/.test(msg));
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    save(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-4 py-2">
      <div className="flex flex-col gap-2">
        <label className="text-xs text-muted-foreground">Approved clock-in</label>
        <input
          type="datetime-local"
          className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
          value={clockIn}
          onChange={(e) => setClockIn(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted-foreground">Approved clock-out</label>
          {!clockOut && (
            <button
              type="button"
              className="text-[11px] text-primary hover:underline"
              onClick={() => {
                const baseDate = clockIn ? new Date(clockIn) : new Date(record.date);
                const pad = (n: number) => String(n).padStart(2, "0");
                setClockOut(`${baseDate.getFullYear()}-${pad(baseDate.getMonth() + 1)}-${pad(baseDate.getDate())}T19:00`);
              }}
            >
              Default (19:00)
            </button>
          )}
        </div>
        <input
          type="datetime-local"
          className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
          value={clockOut}
          onChange={(e) => setClockOut(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-xs text-muted-foreground">&nbsp;</label>
        <label className="flex h-9 cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={isCompensation}
            onChange={(e) => setIsCompensation(e.target.checked)}
          />
          Mark as compensation day
        </label>
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-xs text-muted-foreground">&nbsp;</label>
        <label className="flex h-9 cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={lateExempt}
            onChange={(e) => setLateExempt(e.target.checked)}
          />
          Late exempt (not employee&apos;s fault)
        </label>
      </div>
      {lateExempt && (
        <div className="flex flex-col gap-2">
          <label className="text-xs text-muted-foreground">Exempt reason</label>
          <input
            type="text"
            className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
            placeholder="e.g. office inaccessible"
            value={lateExemptReason}
            onChange={(e) => setLateExemptReason(e.target.value)}
          />
        </div>
      )}
      {error && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm text-destructive">{error}</p>
          {longDurationError && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              disabled={submitting}
              onClick={() => save(true)}
            >
              Save anyway — this duration is correct
            </Button>
          )}
        </div>
      )}
      <Button type="submit" size="sm" disabled={submitting}>
        {submitting ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

// Admin/HR section (2026-08-08): view and revert employee self-declared
// weekly-off moves. Only active moves are shown (already-reverted ones are
// history, not actionable). Hidden entirely when no active moves exist so
// it doesn't clutter the page on normal weeks.
type WeeklyOffMove = {
  id: string;
  employee: { id: string; fullName: string };
  weekStart: string;
  date: string;
};

function WeeklyOffMovesSection() {
  const [moves, setMoves] = useState<WeeklyOffMove[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revertingId, setRevertingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/attendance/weekly-off/all");
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      setMoves(json.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load weekly off claims.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function revert(id: string) {
    if (!window.confirm("Revert this weekly off? The team's default day will apply and the employee will be notified.")) return;
    setRevertingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/v1/attendance/weekly-off/${id}/revert`, { method: "POST" });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to revert weekly off.");
    } finally {
      setRevertingId(null);
    }
  }

  // Hide entirely when loading is done and there's nothing to show.
  if (!loading && moves.length === 0 && !error) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Weekly off claims</CardTitle>
      </CardHeader>
      <CardContent>
        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Week of</TableHead>
                <TableHead>Claimed off date</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {moves.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>{m.employee.fullName}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(m.weekStart)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{formatDate(m.date)}</Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={revertingId === m.id}
                      onClick={() => revert(m.id)}
                    >
                      {revertingId === m.id ? "Reverting…" : "Revert"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// Admin/HR override (2026-08-07; widened from admin-only same day):
// switches between the single-record form (unchanged) and the bulk
// (multi-employee x multi-date) form.
function ManualRecordSection() {
  const [mode, setMode] = useState<"single" | "bulk">("single");
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Manual record (Admin/HR override)</CardTitle>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={mode === "single" ? "default" : "outline"}
            onClick={() => setMode("single")}
          >
            Single
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "bulk" ? "default" : "outline"}
            onClick={() => setMode("bulk")}
          >
            Bulk add
          </Button>
        </div>
      </CardHeader>
      <CardContent>{mode === "single" ? <ManualRecordForm /> : <BulkManualRecordForm />}</CardContent>
    </Card>
  );
}

// Admin/HR override (2026-07-15; widened to HR 2026-08-07): create/overwrite
// an attendance record by hand for any employee/date — POST
// /api/v1/attendance/manual (audited, written pre-approved with the actor
// as approver).
function ManualRecordForm() {
  const [employees, setEmployees] = useState<{ id: string; fullName: string }[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [clockIn, setClockIn] = useState("09:00");
  const [clockOut, setClockOut] = useState("18:00");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [longDurationError, setLongDurationError] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/v1/employees");
      const json = await res.json();
      if (json.data) setEmployees(json.data);
    })();
  }, []);

  async function save(confirmLongDuration = false) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/v1/attendance/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employeeId,
          date,
          clock_in: new Date(`${date}T${clockIn}`).toISOString(),
          clock_out: clockOut ? new Date(`${date}T${clockOut}`).toISOString() : undefined,
          reason,
          confirm_long_duration: confirmLongDuration || undefined,
        }),
      });
      const json = await res.json();
      if (json.error) {
        setLongDurationError(/beyond a normal shift/.test(json.error.message));
        throw new Error(json.error.message);
      }
      setLongDurationError(false);
      setMessage("Record saved (pre-approved). Refresh the table below to see it.");
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save record.");
    } finally {
      setBusy(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    save(false);
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="manual_employee">Employee</Label>
        <Select value={employeeId || "__none__"} onValueChange={(v) => setEmployeeId(v === "__none__" ? "" : v)}>
          <SelectTrigger id="manual_employee">
            <SelectValue placeholder="Select employee" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Select…</SelectItem>
            {employees.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.fullName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="manual_date">Date</Label>
        <DatePicker id="manual_date" value={date} onChange={setDate} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="manual_in">Clock in</Label>
        <Input id="manual_in" type="time" value={clockIn} onChange={(e) => setClockIn(e.target.value)} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="manual_out">Clock out</Label>
        <Input id="manual_out" type="time" value={clockOut} onChange={(e) => setClockOut(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor="manual_reason">Reason (audited)</Label>
        <Input
          id="manual_reason"
          placeholder="e.g. forgot to clock in, device issue"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
        />
      </div>
      {error && (
        <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-3">
          <p className="text-sm text-destructive">{error}</p>
          {longDurationError && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              disabled={busy}
              onClick={() => save(true)}
            >
              Save anyway — this duration is correct
            </Button>
          )}
        </div>
      )}
      {message && <p className="text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">{message}</p>}
      <Button type="submit" disabled={busy || !employeeId} className="w-fit">
        {busy ? "Saving…" : "Save manual record"}
      </Button>
    </form>
  );
}

// Admin/HR override (2026-08-07): bulk sibling of ManualRecordForm — pick
// multiple employees + a date range, generate an employee x date grid with a
// uniform default time that's still per-row editable, then submit the whole
// grid to POST /attendance/manual/bulk in one call.
type BulkRow = {
  key: string;
  employeeId: string;
  employeeName: string;
  date: string;
  clockIn: string;
  clockOut: string;
};

function dateRange(from: string, to: string): string[] {
  if (!from || !to) return [];
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];
  const dates: string[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

function BulkManualRecordForm() {
  const [employees, setEmployees] = useState<{ id: string; fullName: string }[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [defaultIn, setDefaultIn] = useState("09:00");
  const [defaultOut, setDefaultOut] = useState("18:00");
  const [reason, setReason] = useState("");
  const [rows, setRows] = useState<BulkRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [longDurationRows, setLongDurationRows] = useState<BulkRow[]>([]);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/v1/employees");
      const json = await res.json();
      if (json.data) setEmployees(json.data);
    })();
  }, []);

  function generateRows() {
    const dates = dateRange(dateFrom, dateTo);
    const byId = new Map(employees.map((e) => [e.id, e.fullName]));
    const next: BulkRow[] = [];
    for (const empId of selectedIds) {
      for (const d of dates) {
        next.push({
          key: `${empId}-${d}`,
          employeeId: empId,
          employeeName: byId.get(empId) ?? empId,
          date: d,
          clockIn: defaultIn,
          clockOut: defaultOut,
        });
      }
    }
    setRows(next);
    setMessage(null);
    setError(null);
    setLongDurationRows([]);
  }

  function updateRow(key: string, field: "clockIn" | "clockOut", value: string) {
    setRows((prev) => (prev ? prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)) : prev));
  }

  function removeRow(key: string) {
    setRows((prev) => (prev ? prev.filter((r) => r.key !== key) : prev));
  }

  async function submitRows(rowsToSubmit: BulkRow[], confirmLongDuration: boolean) {
    setBusy(true);
    setError(null);
    if (!confirmLongDuration) {
      setMessage(null);
      setLongDurationRows([]);
    }
    try {
      const res = await fetch("/api/v1/attendance/manual/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason,
          records: rowsToSubmit.map((r) => ({
            employee_id: r.employeeId,
            date: r.date,
            clock_in: new Date(`${r.date}T${r.clockIn}`).toISOString(),
            clock_out: r.clockOut ? new Date(`${r.date}T${r.clockOut}`).toISOString() : undefined,
            confirm_long_duration: confirmLongDuration || undefined,
          })),
        }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      const { created, updated, failed, results } = json.data as {
        created: number;
        updated: number;
        failed: number;
        results: { employee_id: string; date: string; ok: boolean; error?: string }[];
      };
      const stillLongDuration = results.filter((r) => !r.ok && /beyond a normal shift/.test(r.error ?? ""));
      const flaggedRows = rowsToSubmit.filter((row) =>
        stillLongDuration.some((r) => r.employee_id === row.employeeId && r.date === row.date),
      );
      setLongDurationRows(flaggedRows);
      setMessage(
        `${created} created, ${updated} updated${failed ? `, ${failed} failed` : ""}` +
          (flaggedRows.length > 0
            ? ` — ${flaggedRows.length} flagged below for an unusually long duration.`
            : ". Refresh the table below to see them."),
      );
      setRows(null);
      if (flaggedRows.length === 0) setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save records.");
    } finally {
      setBusy(false);
    }
  }

  function submitAll() {
    if (!rows || rows.length === 0) return;
    submitRows(rows, false);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-4">
          <Label>Employees</Label>
          <EmployeeMultiSelect employees={employees} selectedIds={selectedIds} onChange={setSelectedIds} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bulk_from">Date from</Label>
          <DatePicker id="bulk_from" value={dateFrom} onChange={setDateFrom} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bulk_to">Date to</Label>
          <DatePicker id="bulk_to" value={dateTo} onChange={setDateTo} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bulk_in">Default clock in</Label>
          <Input id="bulk_in" type="time" value={defaultIn} onChange={(e) => setDefaultIn(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bulk_out">Default clock out</Label>
          <Input id="bulk_out" type="time" value={defaultOut} onChange={(e) => setDefaultOut(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-3">
          <Label htmlFor="bulk_reason">Reason (audited)</Label>
          <Input
            id="bulk_reason"
            placeholder="e.g. backfilling device outage week"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <Button type="button" variant="outline" onClick={generateRows} disabled={selectedIds.length === 0} className="w-fit self-end">
          Generate rows
        </Button>
      </div>

      {rows && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {rows.length} row(s) — edit any row&apos;s time before submitting, or remove it.
          </p>
          <div className="max-h-80 overflow-y-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Clock in</TableHead>
                  <TableHead>Clock out</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell>{r.employeeName}</TableCell>
                    <TableCell>{r.date}</TableCell>
                    <TableCell>
                      <Input
                        type="time"
                        value={r.clockIn}
                        onChange={(e) => updateRow(r.key, "clockIn", e.target.value)}
                        className="h-8 w-28"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="time"
                        value={r.clockOut}
                        onChange={(e) => updateRow(r.key, "clockOut", e.target.value)}
                        className="h-8 w-28"
                      />
                    </TableCell>
                    <TableCell>
                      <Button type="button" size="sm" variant="ghost" onClick={() => removeRow(r.key)}>
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Button
            type="button"
            onClick={submitAll}
            disabled={busy || rows.length === 0 || !reason.trim()}
            className="w-fit"
          >
            {busy ? "Saving…" : `Save ${rows.length} record(s)`}
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      {longDurationRows.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 dark:bg-amber-950/20">
          <p className="text-sm text-muted-foreground">
            These rows are beyond a normal shift (&gt;{MAX_PLAUSIBLE_SHIFT_HOURS}h) — double-check the times, or confirm they&apos;re correct:
          </p>
          <ul className="text-sm">
            {longDurationRows.map((r) => (
              <li key={r.key}>
                {r.employeeName} — {r.date}, {r.clockIn}–{r.clockOut}
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            disabled={busy}
            onClick={() => submitRows(longDurationRows, true)}
          >
            Save anyway — these durations are correct
          </Button>
        </div>
      )}
    </div>
  );
}

// Searchable multi-select for the employee picker above — a flat wrap of
// pills stopped scaling once the roster grows past a couple dozen people
// (unbounded row count, no way to find one name quickly). This keeps
// selection state on the outside (same value/onChange contract as before)
// but renders as a single trigger + popover with a search box and a
// scrollable checkbox list, so the picker's footprint stays constant
// regardless of headcount.
function EmployeeMultiSelect({
  employees,
  selectedIds,
  onChange,
}: {
  employees: { id: string; fullName: string }[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = employees.filter((e) => e.fullName.toLowerCase().includes(query.trim().toLowerCase()));
  const selectedSet = new Set(selectedIds);
  const byId = new Map(employees.map((e) => [e.id, e.fullName]));

  function toggle(id: string) {
    onChange(selectedSet.has(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  }

  return (
    <div className="flex flex-col gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="h-10 w-full justify-between gap-2 px-3 font-normal"
          >
            <span className={selectedIds.length === 0 ? "text-muted-foreground" : ""}>
              {selectedIds.length === 0
                ? "Select employees…"
                : `${selectedIds.length} employee${selectedIds.length === 1 ? "" : "s"} selected`}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="size-4 shrink-0 opacity-50" />
            <input
              autoFocus
              placeholder="Search employees…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-7 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
            <button
              type="button"
              className="underline"
              onClick={() => onChange([...new Set([...selectedIds, ...filtered.map((e) => e.id)])])}
            >
              Select all{query ? " (filtered)" : ""}
            </button>
            <button type="button" className="underline" onClick={() => onChange([])}>
              Clear
            </button>
          </div>
          <div className="max-h-60 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-center text-sm text-muted-foreground">No matches.</p>
            ) : (
              filtered.map((e) => (
                <label
                  key={e.id}
                  className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <input
                    type="checkbox"
                    className="size-4 shrink-0"
                    checked={selectedSet.has(e.id)}
                    onChange={() => toggle(e.id)}
                  />
                  {e.fullName}
                </label>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
      {selectedIds.length > 0 && (
        <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
          {selectedIds.map((id) => (
            <span
              key={id}
              className="flex items-center gap-1 rounded-full border border-input bg-background px-2 py-0.5 text-xs"
            >
              {byId.get(id) ?? id}
              <button type="button" onClick={() => toggle(id)} aria-label={`Remove ${byId.get(id) ?? id}`}>
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
