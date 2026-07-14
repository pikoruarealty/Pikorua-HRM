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

// Working-day assumption for the "Absent" estimate below: Mon-Sat, no
// holiday calendar (none exists in the schema yet). This is a visible,
// documented approximation, not an authoritative payroll figure — the
// late/half-day/unpaid-leave numbers above it come straight from the
// approved-only summary endpoint and are the ones payroll actually uses.
function countWorkingDaysSoFar(periodStart: Date, periodEndExclusive: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = periodEndExclusive < today ? periodEndExclusive : today;
  let count = 0;
  for (let d = new Date(periodStart); d < end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0) count += 1; // exclude Sundays only
  }
  return count;
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

  const [year, mo] = month.split("-").map(Number);
  const periodStart = new Date(Date.UTC(year, mo - 1, 1));
  const periodEndExclusive = new Date(Date.UTC(year, mo, 1));
  const presentDays = records.length;
  const workingDaysSoFar = countWorkingDaysSoFar(periodStart, periodEndExclusive);
  const absentEstimate = Math.max(
    0,
    workingDaysSoFar - presentDays - (summary?.unpaid_leave_count ?? 0),
  );

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
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Stat label="Present" value={presentDays} />
              <Stat label="Absent (est.)" value={absentEstimate} />
              <Stat label="Half-days" value={summary?.half_day_count ?? 0} />
              <Stat label="Late (approved)" value={summary?.late_count ?? 0} />
              <Stat
                label="Unpaid leave"
                value={summary?.unpaid_leave_count ?? "—"}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              &quot;Absent (est.)&quot; = working days so far this month (Mon–Sat) minus
              present days minus unpaid leave days — there&apos;s no holiday calendar yet,
              so treat it as an estimate, not a payroll figure.
              {summary?.notes.unpaid_leave_unavailable && (
                <> Unpaid leave isn&apos;t available yet ({summary.notes.unpaid_leave_unavailable}), so it&apos;s excluded from this estimate.</>
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
