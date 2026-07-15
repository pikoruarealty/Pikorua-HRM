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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  approvalStatus: "pending" | "approved";
};

async function getJson(res: Response) {
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data;
}

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function AttendanceScreen({
  canReview,
  canSeeAll,
  employeeId,
  isAdmin,
}: {
  /** Admin/HR — can edit + approve. */
  canReview: boolean;
  /** Admin/HR or Lead — sees more than just their own records. */
  canSeeAll: boolean;
  employeeId: string | null;
  /** Admin only — manual-record override form. */
  isAdmin: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Attendance</h1>
        <p className="text-sm text-muted-foreground">
          Manual clock-in/out, {canReview ? "review, and approval" : "and history"}.
        </p>
      </div>

      {employeeId && <ClockWidget employeeId={employeeId} />}

      {canReview && <AttendanceOverviewPanel />}

      {isAdmin && <ManualRecordForm />}

      <AttendanceTable canReview={canReview} canSeeAll={canSeeAll} employeeId={employeeId} />
    </div>
  );
}

function ClockWidget({ employeeId }: { employeeId: string }) {
  const [today, setToday] = useState<AttendanceRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const iso = new Date().toISOString().slice(0, 10);
      const records: AttendanceRecord[] = await getJson(
        await fetch(`/api/v1/attendance?employee_id=${employeeId}&date_from=${iso}&date_to=${iso}`),
      );
      setToday(records[0] ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load today's record.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function clockIn() {
    setBusy(true);
    setError(null);
    try {
      await getJson(await fetch("/api/v1/attendance/clock-in", { method: "POST" }));
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to clock in.");
    } finally {
      setBusy(false);
    }
  }

  async function clockOut() {
    setBusy(true);
    setError(null);
    try {
      await getJson(await fetch("/api/v1/attendance/clock-out", { method: "POST" }));
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to clock out.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Today</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="text-sm text-muted-foreground">
              Clock-in: <span className="text-foreground">{fmt(today?.clockInRaw ?? null)}</span>
              {"  ·  "}
              Clock-out: <span className="text-foreground">{fmt(today?.clockOutRaw ?? null)}</span>
            </div>
            <Button onClick={clockIn} disabled={busy || !!today?.clockInRaw}>
              Clock In
            </Button>
            <Button
              variant="outline"
              onClick={clockOut}
              disabled={busy || !today?.clockInRaw || !!today?.clockOutRaw}
            >
              Clock Out
            </Button>
          </>
        )}
        {error && <p className="w-full text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

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
  const [statusFilter, setStatusFilter] = useState<"" | "pending" | "approved">("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const qs = statusFilter ? `?approval_status=${statusFilter}` : "";
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

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{canSeeAll ? "Attendance records" : "My attendance"}</CardTitle>
        {canReview && (
          <Select
            value={statusFilter || "__all__"}
            onValueChange={(v) =>
              setStatusFilter(v === "__all__" ? "" : (v as typeof statusFilter))
            }
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
      </CardHeader>
      <CardContent>
        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : records.length === 0 ? (
          <p className="text-sm text-muted-foreground">No attendance records.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {canSeeAll && <TableHead>Employee</TableHead>}
                <TableHead>Date</TableHead>
                <TableHead>Clock in</TableHead>
                <TableHead>Clock out</TableHead>
                <TableHead>Hours</TableHead>
                <TableHead>Status</TableHead>
                {canReview && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((r) => (
                <Fragment key={r.id}>
                  <TableRow>
                    {canSeeAll && <TableCell>{r.employee.fullName}</TableCell>}
                    <TableCell>{new Date(r.date).toLocaleDateString()}</TableCell>
                    <TableCell>{fmt(r.clockInApproved ?? r.clockInRaw)}</TableCell>
                    <TableCell>{fmt(r.clockOutApproved ?? r.clockOutRaw)}</TableCell>
                    <TableCell>
                      {r.totalHours ?? "—"}
                      {r.isHalfDay && (
                        <Badge variant="secondary" className="ml-2">
                          Half-day
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.approvalStatus === "approved" ? "default" : "outline"}>
                        {r.approvalStatus}
                      </Badge>
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
                          {r.approvalStatus === "pending" && (
                            <Button
                              size="sm"
                              disabled={busyId === r.id}
                              onClick={() => approve(r.id)}
                            >
                              {busyId === r.id ? "Approving…" : "Approve"}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                  {canReview && editingId === r.id && (
                    <TableRow>
                      <TableCell colSpan={canSeeAll ? 7 : 6}>
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
              ))}
            </TableBody>
          </Table>
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
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
          }),
        }),
      );
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSubmitting(false);
    }
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
        <label className="text-xs text-muted-foreground">Approved clock-out</label>
        <input
          type="datetime-local"
          className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
          value={clockOut}
          onChange={(e) => setClockOut(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" size="sm" disabled={submitting}>
        {submitting ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

// Admin-only override (2026-07-15): create/overwrite an attendance record by
// hand for any employee/date — POST /api/v1/attendance/manual (audited,
// written pre-approved with the admin as approver).
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

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/v1/employees");
      const json = await res.json();
      if (json.data) setEmployees(json.data);
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
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
        }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      setMessage("Record saved (pre-approved). Refresh the table below to see it.");
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save record.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Manual record (admin override)</CardTitle>
      </CardHeader>
      <CardContent>
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
            <Input id="manual_date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
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
          {error && <p className="text-sm text-destructive sm:col-span-2 lg:col-span-3">{error}</p>}
          {message && <p className="text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">{message}</p>}
          <Button type="submit" disabled={busy || !employeeId} className="w-fit">
            {busy ? "Saving…" : "Save manual record"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
