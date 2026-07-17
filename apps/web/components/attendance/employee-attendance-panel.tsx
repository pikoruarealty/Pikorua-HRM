"use client";

import { useEffect, useState } from "react";
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
  date: string;
  clockInRaw: string | null;
  clockOutRaw: string | null;
  clockInApproved: string | null;
  clockOutApproved: string | null;
  totalHours: string | null;
  isHalfDay: boolean;
  approvalStatus: "pending" | "approved";
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
  compensation_days: number;
  holiday_days: number;
  working_days_elapsed: number;
  notes: { late_tracking_unavailable?: string; unpaid_leave_unavailable?: string };
};

async function getJson(res: Response) {
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data;
}

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, { timeStyle: "short" });
}

export function EmployeeAttendancePanel({ employeeId }: { employeeId: string }) {
  const now = new Date();
  const [month, setMonth] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
  );
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [year, mo] = month.split("-").map(Number);
        const periodStart = new Date(Date.UTC(year, mo - 1, 1));
        const periodEndExclusive = new Date(Date.UTC(year, mo, 1));
        const dateFrom = periodStart.toISOString().slice(0, 10);
        const dateTo = new Date(periodEndExclusive.getTime() - 86400000)
          .toISOString()
          .slice(0, 10);

        const [recordsData, summaryData] = await Promise.all([
          getJson(
            await fetch(
              `/api/v1/attendance?employee_id=${employeeId}&date_from=${dateFrom}&date_to=${dateTo}`,
            ),
          ),
          getJson(
            await fetch(`/api/v1/attendance/${employeeId}/summary?month=${mo}&year=${year}`),
          ),
        ]);
        setRecords(recordsData);
        setSummary(summaryData);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load attendance.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [employeeId, month]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Attendance</CardTitle>
        <input
          type="month"
          className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              <Stat label="Present" value={summary?.present_days ?? 0} />
              <Stat label="Half-day" value={summary?.half_days ?? 0} />
              <Stat label="Absent" value={summary?.absent_days ?? 0} />
              <Stat label="Late (approved)" value={summary?.late_count ?? 0} />
              <Stat label="Paid leave" value={summary?.paid_leave_days ?? 0} />
              <Stat label="Unpaid leave" value={summary?.unpaid_leave_days ?? 0} />
              <Stat label="Compensation" value={summary?.compensation_days ?? 0} />
              <Stat label="Holidays" value={summary?.holiday_days ?? 0} />
            </div>
            <p className="text-xs text-muted-foreground">
              Present/absent/leave/holiday counts are computed from approved attendance, approved
              leave requests, and the company holiday calendar (Sundays are off unless the employee
              clocked in, which counts as a compensation day instead).
              {summary?.notes.unpaid_leave_unavailable && (
                <> Unpaid leave isn&apos;t available yet ({summary.notes.unpaid_leave_unavailable}).</>
              )}
              {summary?.notes.late_tracking_unavailable && (
                <> {summary.notes.late_tracking_unavailable}</>
              )}
            </p>

            {records.length === 0 ? (
              <p className="text-sm text-muted-foreground">No attendance records this month.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Clock in</TableHead>
                    <TableHead>Clock out</TableHead>
                    <TableHead>Hours</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{new Date(r.date).toLocaleDateString()}</TableCell>
                      <TableCell>{fmtTime(r.clockInApproved ?? r.clockInRaw)}</TableCell>
                      <TableCell>{fmtTime(r.clockOutApproved ?? r.clockOutRaw)}</TableCell>
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
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
