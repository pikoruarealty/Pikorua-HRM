"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
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

type Employee = { id: string; fullName: string };

type Payslip = {
  id: string;
  employeeId: string;
  employee: { id: string; fullName: string };
  periodMonth: number;
  periodYear: number;
  netPay: string;
  status: "draft" | "finalized";
  employeeOfMonthRef: boolean;
};

async function getJson(res: Response) {
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data;
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function PayslipsScreen({ canGenerate }: { canGenerate: boolean }) {
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await getJson(await fetch("/api/v1/payslips"));
      setPayslips(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load payslips.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Payslips</h1>
        <p className="text-sm text-muted-foreground">
          {canGenerate ? "Generate and review payslips." : "Your finalized payslips."}
        </p>
      </div>

      {canGenerate && <GenerateForm onGenerated={load} />}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>{payslips.length} payslip(s)</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : payslips.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payslips yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {canGenerate && <TableHead>Employee</TableHead>}
                  <TableHead>Period</TableHead>
                  <TableHead>Net pay</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>EoM</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {payslips.map((p) => (
                  <TableRow key={p.id}>
                    {canGenerate && <TableCell>{p.employee.fullName}</TableCell>}
                    <TableCell>
                      {MONTH_NAMES[p.periodMonth - 1]} {p.periodYear}
                    </TableCell>
                    <TableCell>₹{p.netPay}</TableCell>
                    <TableCell>
                      <Badge variant={p.status === "finalized" ? "default" : "outline"}>
                        {p.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{p.employeeOfMonthRef ? "🏆" : "—"}</TableCell>
                    <TableCell>
                      <Link
                        href={`/payslips/${p.id}`}
                        className="text-sm font-medium text-primary hover:underline"
                      >
                        View
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function GenerateForm({ onGenerated }: { onGenerated: () => void }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [incentive, setIncentive] = useState("0");
  const [bonus, setBonus] = useState("0");
  const [bonusReason, setBonusReason] = useState("");
  const [otherAddition, setOtherAddition] = useState("");
  const [otherAdditionReason, setOtherAdditionReason] = useState("");
  const [otherDeduction, setOtherDeduction] = useState("");
  const [otherDeductionReason, setOtherDeductionReason] = useState("");

  const [eomStatus, setEomStatus] = useState<boolean | null>(null);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await getJson(await fetch("/api/v1/employees"));
        setEmployees(data);
      } catch {
        // non-fatal for this form; the select just stays empty
      }
    })();
  }, []);

  useEffect(() => {
    setEomStatus(null);
    if (!employeeId) return;
    (async () => {
      try {
        const data = await getJson(
          await fetch(`/api/v1/payslips/${employeeId}/employee-of-month-status?month=${month}&year=${year}`),
        );
        setEomStatus(data.is_employee_of_month);
      } catch {
        setEomStatus(null);
      }
    })();
  }, [employeeId, month, year]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setPreview(null);
    try {
      const data = await getJson(
        await fetch("/api/v1/payslips/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employee_id: employeeId,
            month,
            year,
            incentive_amount: incentive || 0,
            bonus_amount: bonus || 0,
            bonus_reason: bonusReason || undefined,
            other_addition_amount: otherAddition || undefined,
            other_addition_reason: otherAdditionReason || undefined,
            other_deduction_amount: otherDeduction || undefined,
            other_deduction_reason: otherDeductionReason || undefined,
          }),
        }),
      );
      setPreview(data);
      onGenerated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate payslip.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Generate payslip</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="employee">Employee</Label>
              <select
                id="employee"
                required
                className="flex h-10 w-56 rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
              >
                <option value="">Select…</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="month">Month</Label>
              <select
                id="month"
                className="flex h-10 w-28 rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
              >
                {MONTH_NAMES.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="year">Year</Label>
              <Input
                id="year"
                type="number"
                className="w-24"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
              />
            </div>
            {eomStatus !== null && (
              <Badge variant={eomStatus ? "default" : "secondary"}>
                {eomStatus ? "🏆 Employee of the Month" : "Not EoM this period"}
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="incentive">Incentive (₹)</Label>
              <Input
                id="incentive"
                type="number"
                min="0"
                step="0.01"
                className="w-32"
                value={incentive}
                onChange={(e) => setIncentive(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="bonus">Bonus (₹)</Label>
              <Input
                id="bonus"
                type="number"
                min="0"
                step="0.01"
                className="w-32"
                value={bonus}
                onChange={(e) => setBonus(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="bonusReason">Bonus reason</Label>
              <Input
                id="bonusReason"
                className="w-48"
                value={bonusReason}
                onChange={(e) => setBonusReason(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="otherAddition">Other addition (₹)</Label>
              <Input
                id="otherAddition"
                type="number"
                min="0"
                step="0.01"
                className="w-32"
                value={otherAddition}
                onChange={(e) => setOtherAddition(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="otherAdditionReason">Reason</Label>
              <Input
                id="otherAdditionReason"
                className="w-48"
                value={otherAdditionReason}
                onChange={(e) => setOtherAdditionReason(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="otherDeduction">Other deduction (₹)</Label>
              <Input
                id="otherDeduction"
                type="number"
                min="0"
                step="0.01"
                className="w-32"
                value={otherDeduction}
                onChange={(e) => setOtherDeduction(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="otherDeductionReason">Reason</Label>
              <Input
                id="otherDeductionReason"
                className="w-48"
                value={otherDeductionReason}
                onChange={(e) => setOtherDeductionReason(e.target.value)}
              />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <div>
            <Button type="submit" disabled={submitting || !employeeId}>
              {submitting ? "Generating…" : "Generate"}
            </Button>
          </div>
        </form>

        {preview && (
          <div className="rounded-md border p-4 text-sm">
            <p className="mb-2 font-medium">Generated — net pay: ₹{String(preview.netPay)}</p>
            <p className="text-muted-foreground">
              Base ₹{String(preview.baseSalary)} · standard deductions ₹
              {String(preview.standardDeductionTotal)} (late {String(preview.lateCount)}, half-day{" "}
              {String(preview.halfDayCount)}, unpaid leave {String(preview.unpaidLeaveCount)}) ·
              reimbursement ₹{String(preview.reimbursementTotal)}
            </p>
            <Link
              href={`/payslips/${(preview as { id: string }).id}`}
              className="mt-2 inline-block font-medium text-primary hover:underline"
            >
              View payslip →
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
