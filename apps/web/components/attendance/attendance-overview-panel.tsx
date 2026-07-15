"use client";

import { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { EmployeeAvatar } from "@/components/employees/employee-avatar";

// Admin/HR "glance" panel (2026-07-15): whole-company attendance for one day
// — present / half-day / on-leave / absent / late counts + per-employee rows.
// Data from GET /api/v1/attendance/overview (finance-only).

type OverviewRow = {
  employeeId: string;
  fullName: string;
  photoUrl: string | null;
  team: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  status: "present" | "half_day" | "on_leave" | "absent" | "holiday";
  late: boolean;
  leaveType: string | null;
  clockIn: string | null;
  clockOut: string | null;
  totalHours: string | null;
  approvalStatus: "pending" | "approved" | null;
};

type Overview = {
  date: string;
  holiday: { id: string; name: string } | null;
  counts: {
    total: number;
    present: number;
    halfDay: number;
    onLeave: number;
    absent: number;
    late: number;
    pendingApproval: number;
  };
  rows: OverviewRow[];
};

const STATUS_LABELS: Record<OverviewRow["status"], string> = {
  present: "Present",
  half_day: "Half-day",
  on_leave: "On leave",
  absent: "Absent",
  holiday: "Holiday",
};

const STATUS_VARIANTS: Record<OverviewRow["status"], "default" | "secondary" | "destructive" | "outline"> = {
  present: "default",
  half_day: "secondary",
  on_leave: "outline",
  absent: "destructive",
  holiday: "secondary",
};

async function getJson(res: Response) {
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data;
}

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function AttendanceOverviewPanel() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOverview(await getJson(await fetch(`/api/v1/attendance/overview?date=${date}`)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load overview.");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  const tiles = overview
    ? [
        { label: "Active employees", value: overview.counts.total },
        { label: "Present", value: overview.counts.present },
        { label: "Half-day", value: overview.counts.halfDay },
        { label: "On leave", value: overview.counts.onLeave },
        { label: "Absent", value: overview.counts.absent, alert: overview.counts.absent > 0 && !overview.holiday },
        { label: "Late", value: overview.counts.late, alert: overview.counts.late > 0 },
        { label: "Pending approval", value: overview.counts.pendingApproval, alert: overview.counts.pendingApproval > 0 },
      ]
    : [];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle>Daily overview</CardTitle>
        <div className="flex items-center gap-2">
          <Label htmlFor="overview_date" className="text-xs text-muted-foreground">
            Date
          </Label>
          <Input
            id="overview_date"
            type="date"
            className="w-auto"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
        </div>
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
            {overview.holiday && (
              <p className="text-sm">
                <Badge variant="secondary">Holiday</Badge>{" "}
                <span className="text-muted-foreground">{overview.holiday.name} — absences not counted.</span>
              </p>
            )}
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Clock in</TableHead>
                  <TableHead>Clock out</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead>Approval</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.rows.map((r) => (
                  <TableRow key={r.employeeId}>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <EmployeeAvatar fullName={r.fullName} photoUrl={r.photoUrl} size="sm" />
                        {r.fullName}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.team?.name ?? "—"}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <Badge variant={STATUS_VARIANTS[r.status]}>{STATUS_LABELS[r.status]}</Badge>
                        {r.late && <Badge variant="destructive">late</Badge>}
                        {r.leaveType && (
                          <span className="text-xs text-muted-foreground">
                            {r.leaveType === "leave_paid" ? "paid" : "unpaid"}
                          </span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell>{fmtTime(r.clockIn)}</TableCell>
                    <TableCell>{fmtTime(r.clockOut)}</TableCell>
                    <TableCell>{r.totalHours ?? "—"}</TableCell>
                    <TableCell>
                      {r.approvalStatus ? (
                        <Badge variant={r.approvalStatus === "approved" ? "default" : "outline"}>
                          {r.approvalStatus}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
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
