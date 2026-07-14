"use client";

import { Fragment, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
}: {
  /** Admin/HR — can edit + approve. */
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
          Manual clock-in/out, {canReview ? "review, and approval" : "and history"}.
        </p>
      </div>

      {employeeId && <ClockWidget employeeId={employeeId} />}

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
          <select
            className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
          </select>
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
