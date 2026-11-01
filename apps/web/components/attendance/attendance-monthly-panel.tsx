"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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
// 2026-11-01: plus banked days (worked in advance, not paid yet) and payable days —
// the figure pay is worked out from (lib/attendance/extra-days.ts).
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
  /** Worked in advance and banked — inside presentDays, not paid. */
  bankedDays: number;
  /** Absent / unpaid days covered by an approved balance day — inside paidLeaveDays. */
  balanceDays: number;
  /** (present − banked) + half×0.5 + paid leave + holidays + compensation. */
  payableDays: number;
  weeklyOffDays: number;
  /** present + half×0.5 + compensation. */
  daysWorked: number;
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
        { label: "Banked", value: overview.totals.bankedDays },
        { label: "Holidays", value: overview.totals.holidayDays },
        { label: "Weekly offs", value: overview.totals.weeklyOffDays },
        { label: "Days worked", value: overview.totals.daysWorked },
        { label: "Payable days", value: overview.totals.payableDays },
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
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
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
              A day worked beyond what was owed (the weekly off, or a part-timer&apos;s day over quota) is paid
              once: if there is an earlier missed day in the last 60 days it is a compensation day that makes
              that day up; otherwise it shows as present and is banked as a balance day until it is
              used on a later absent day. Days worked = present + half-days × 0.5 + compensation. Payable days
              = present (not banked) + half-days × 0.5 + paid leave + holidays + compensation.
            </p>
            {/* Phones: a card per person with the counts as small chips. */}
            <ul className="flex flex-col divide-y rounded-lg border md:hidden">
              {overview.rows.map((r) => (
                <li key={r.employeeId} className="flex flex-col gap-2 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <Link href={`/employees/${r.employeeId}`} className="min-w-0 truncate font-medium">
                      {r.fullName}
                    </Link>
                    {r.team && <span className="shrink-0 text-xs text-muted-foreground">{r.team.name}</span>}
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    <span className="rounded-full border border-primary/40 px-2 py-0.5 font-medium">
                      {r.daysWorked} worked
                    </span>
                    <span className="rounded-full border px-2 py-0.5">{r.presentDays} present</span>
                    {r.halfDays > 0 && <span className="rounded-full border px-2 py-0.5">{r.halfDays} half</span>}
                    {r.absentDays > 0 && (
                      <span className="rounded-full border border-destructive/40 px-2 py-0.5 text-destructive">
                        {r.absentDays} absent
                      </span>
                    )}
                    {r.paidLeaveDays > 0 && <span className="rounded-full border px-2 py-0.5">{r.paidLeaveDays} paid leave</span>}
                    {r.unpaidLeaveDays > 0 && <span className="rounded-full border px-2 py-0.5">{r.unpaidLeaveDays} unpaid</span>}
                    {r.compensationDays > 0 && <span className="rounded-full border px-2 py-0.5">{r.compensationDays} comp</span>}
                    {r.bankedDays > 0 && <span className="rounded-full border px-2 py-0.5">{r.bankedDays} banked</span>}
                    <span className="rounded-full border border-primary/40 px-2 py-0.5 font-medium">{r.payableDays} payable</span>
                    {r.holidayDays > 0 && <span className="rounded-full border px-2 py-0.5">{r.holidayDays} holiday</span>}
                    {r.weeklyOffDays > 0 && <span className="rounded-full border px-2 py-0.5">{r.weeklyOffDays} weekly off</span>}
                  </div>
                </li>
              ))}
            </ul>
            {/* Desktop: one compact row per person (team under the name, short
                headers, numbers right-aligned) so all columns fit without wrapping;
                the table still scrolls sideways rather than overflow the page. */}
            <div className="hidden md:block">
              <Table className="text-xs lg:text-sm">
                <TableHeader>
                  <TableRow className="[&>th]:h-9 [&>th]:whitespace-nowrap [&>th]:px-2 [&>th:not(:first-child)]:text-right">
                    <TableHead>Employee</TableHead>
                    <TableHead>Present</TableHead>
                    <TableHead>Half</TableHead>
                    <TableHead>Absent</TableHead>
                    <TableHead title="Paid leave">Paid lv.</TableHead>
                    <TableHead title="Unpaid leave">Unpaid</TableHead>
                    <TableHead title="Compensation: extra days that made up an earlier missed day">Comp.</TableHead>
                    <TableHead title="Worked in advance: present, banked as a balance day">Banked</TableHead>
                    <TableHead title="Holidays">Hol.</TableHead>
                    <TableHead title="Weekly offs">Offs</TableHead>
                    <TableHead title="Days worked: present + half-days × 0.5 + compensation">Worked</TableHead>
                    <TableHead title="Present (not banked) + half-days × 0.5 + paid leave + holidays + compensation">
                      Payable
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overview.rows.map((r) => (
                    <TableRow
                      key={r.employeeId}
                      className="[&>td]:px-2 [&>td]:py-2 [&>td:not(:first-child)]:text-right [&>td]:tabular-nums"
                    >
                      <TableCell className="max-w-[14rem]">
                        <Link href={`/employees/${r.employeeId}`} className="block truncate font-medium hover:underline">
                          {r.fullName}
                        </Link>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {r.team ? (
                            <Link href={`/teams/${r.team.id}`} className="hover:underline">
                              {r.team.name}
                            </Link>
                          ) : (
                            "No team"
                          )}
                        </span>
                      </TableCell>
                      <TableCell>{r.presentDays}</TableCell>
                      <TableCell>{r.halfDays}</TableCell>
                      <TableCell className={r.absentDays > 0 ? "text-destructive" : undefined}>{r.absentDays}</TableCell>
                      <TableCell>{r.paidLeaveDays}</TableCell>
                      <TableCell>{r.unpaidLeaveDays}</TableCell>
                      <TableCell>{r.compensationDays}</TableCell>
                      <TableCell>{r.bankedDays}</TableCell>
                      <TableCell>{r.holidayDays}</TableCell>
                      <TableCell>{r.weeklyOffDays}</TableCell>
                      <TableCell>{r.daysWorked}</TableCell>
                      <TableCell className="font-semibold">{r.payableDays}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
