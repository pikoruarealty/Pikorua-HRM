"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Admin/HR monthly companion to the daily AttendanceOverviewPanel: per-
// employee present/absent/leave/compensation counts for a whole month.
// Data from GET /api/v1/attendance/monthly-overview (finance-only).

type Row = {
  employeeId: string;
  fullName: string;
  team: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  presentDays: number;
  halfDays: number;
  holidayDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
  compensationDays: number;
  workingDaysElapsed: number;
};

type Totals = Omit<Row, "employeeId" | "fullName" | "team" | "department" | "workingDaysElapsed">;

type Overview = { month: number; year: number; totals: Totals; rows: Row[] };

async function getJson(res: Response) {
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data;
}

export function AttendanceMonthlyPanel() {
  const now = new Date();
  const [month, setMonth] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
  );
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [year, mo] = month.split("-").map(Number);
      setOverview(await getJson(await fetch(`/api/v1/attendance/monthly-overview?month=${mo}&year=${year}`)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load monthly overview.");
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  const tiles = overview
    ? [
        { label: "Present", value: overview.totals.presentDays },
        { label: "Half-day", value: overview.totals.halfDays },
        { label: "Absent", value: overview.totals.absentDays, alert: overview.totals.absentDays > 0 },
        { label: "Paid leave", value: overview.totals.paidLeaveDays },
        { label: "Unpaid leave", value: overview.totals.unpaidLeaveDays },
        { label: "Compensation", value: overview.totals.compensationDays },
        { label: "Holidays", value: overview.totals.holidayDays },
      ]
    : [];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle>Monthly overview</CardTitle>
        <input
          type="month"
          className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {loading && !overview ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : overview ? (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              {tiles.map((t) => (
                <div key={t.label} className="rounded-lg border p-3">
                  <dt className="text-xs text-muted-foreground">{t.label}</dt>
                  <dd className={`text-2xl font-bold tabular-nums ${t.alert ? "text-destructive" : ""}`}>
                    {t.value}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-muted-foreground">
              Sundays are treated as off unless an employee clocks in — that counts as a compensation
              day instead of a normal present day. Saturdays are regular working days.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Present</TableHead>
                  <TableHead>Half-day</TableHead>
                  <TableHead>Absent</TableHead>
                  <TableHead>Paid leave</TableHead>
                  <TableHead>Unpaid leave</TableHead>
                  <TableHead>Compensation</TableHead>
                  <TableHead>Holidays</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.rows.map((r) => (
                  <TableRow key={r.employeeId}>
                    <TableCell>{r.fullName}</TableCell>
                    <TableCell className="text-muted-foreground">{r.team?.name ?? "—"}</TableCell>
                    <TableCell>{r.presentDays}</TableCell>
                    <TableCell>{r.halfDays}</TableCell>
                    <TableCell className={r.absentDays > 0 ? "text-destructive" : undefined}>
                      {r.absentDays}
                    </TableCell>
                    <TableCell>{r.paidLeaveDays}</TableCell>
                    <TableCell>{r.unpaidLeaveDays}</TableCell>
                    <TableCell>{r.compensationDays}</TableCell>
                    <TableCell>{r.holidayDays}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
