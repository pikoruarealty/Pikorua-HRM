"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

type Employee = { id: string; fullName: string };

type PayslipPreview = {
  baseSalary: number;
  perDayRate: number;
  presentDays: number;
  halfDays: number;
  paidLeaveDays: number;
  holidayDays: number;
  compensationDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
  lateCount: number;
  earnedBasePay: number;
  lateDeductionTotal: number;
  reimbursementTotal: number;
  employeeOfMonthRef: boolean;
  netPay: number;
  notes: { late_tracking_unavailable?: string; employee_of_month_unavailable?: string };
};

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

export function PayslipsScreen({
  canGenerate,
  isAdmin,
}: {
  canGenerate: boolean;
  isAdmin: boolean;
}) {
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Admin-only overrides (audited server-side): finalized → draft, and
  // delete-draft — together the correction/regeneration flow.
  async function unfinalize(id: string) {
    const reason = prompt("Reason for unfinalizing this payslip?");
    if (!reason) return;
    setError(null);
    try {
      await getJson(
        await fetch(`/api/v1/payslips/${id}/unfinalize`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        }),
      );
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to unfinalize.");
    }
  }

  async function deleteDraft(id: string) {
    if (!confirm("Delete this draft payslip? It can be regenerated afterwards.")) return;
    setError(null);
    try {
      await getJson(await fetch(`/api/v1/payslips/${id}`, { method: "DELETE" }));
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete draft.");
    }
  }

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
                      <span className="flex items-center gap-2">
                        <Link
                          href={`/payslips/${p.id}`}
                          className="text-sm font-medium text-primary hover:underline"
                        >
                          View
                        </Link>
                        {isAdmin && p.status === "finalized" && (
                          <Button size="sm" variant="ghost" onClick={() => unfinalize(p.id)}>
                            Unfinalize
                          </Button>
                        )}
                        {isAdmin && p.status === "draft" && (
                          <Button size="sm" variant="ghost" onClick={() => deleteDraft(p.id)}>
                            Delete
                          </Button>
                        )}
                      </span>
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

  const [preview, setPreview] = useState<PayslipPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [generatedResult, setGeneratedResult] = useState<{ id: string; netPay: string } | null>(null);
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

  // Live projection: as soon as an employee/period is picked (or any manual
  // amount changes), show the same breakdown + net pay the server would
  // compute on Generate — debounced so typing a manual amount doesn't fire a
  // request per keystroke. Reuses POST /payslips/preview (same math as
  // generate, via lib/payroll/payslip-preview.ts — never drifts from what
  // Generate actually persists).
  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    if (!employeeId) return;
    setPreviewLoading(true);
    const t = setTimeout(async () => {
      try {
        const data = await getJson(
          await fetch("/api/v1/payslips/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              employee_id: employeeId,
              month,
              year,
              incentive_amount: incentive || 0,
              bonus_amount: bonus || 0,
              other_addition_amount: otherAddition || undefined,
              other_deduction_amount: otherDeduction || undefined,
            }),
          }),
        );
        setPreview(data);
      } catch (e) {
        setPreviewError(e instanceof Error ? e.message : "Failed to compute preview.");
      } finally {
        setPreviewLoading(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [employeeId, month, year, incentive, bonus, otherAddition, otherDeduction]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setGeneratedResult(null);
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
      setGeneratedResult(data);
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
      <CardContent className="flex flex-col gap-6">
        <form onSubmit={onSubmit} className="flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Employee &amp; period</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="employee">Employee</Label>
                <Select value={employeeId || undefined} onValueChange={setEmployeeId}>
                  <SelectTrigger id="employee">
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="month">Month</Label>
                <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                  <SelectTrigger id="month">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTH_NAMES.map((m, i) => (
                      <SelectItem key={m} value={String(i + 1)}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="year">Year</Label>
                <Input
                  id="year"
                  type="number"
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                />
              </div>
            </div>
            {preview && (
              <Badge variant={preview.employeeOfMonthRef ? "default" : "secondary"} className="w-fit">
                {preview.employeeOfMonthRef ? "🏆 Employee of the Month" : "Not EoM this period"}
              </Badge>
            )}
          </section>

          {employeeId && (
            <section className="flex flex-col gap-3 rounded-lg border p-4">
              <h3 className="text-sm font-semibold text-muted-foreground">Salary breakdown (projected)</h3>
              {previewError && <p className="text-sm text-destructive">{previewError}</p>}
              {preview ? (
                <>
                  <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                    <BreakdownStat label="Present" value={preview.presentDays} />
                    <BreakdownStat label="Half-day" value={preview.halfDays} />
                    <BreakdownStat label="Absent" value={preview.absentDays} />
                    <BreakdownStat label="Paid leave" value={preview.paidLeaveDays} />
                    <BreakdownStat label="Unpaid leave" value={preview.unpaidLeaveDays} />
                    <BreakdownStat label="Compensation" value={preview.compensationDays} />
                    <BreakdownStat label="Holidays" value={preview.holidayDays} />
                  </dl>
                  <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <Row label="Earned base pay" value={`₹${preview.earnedBasePay.toFixed(2)}`} />
                    <Row
                      label="Late deduction"
                      value={`−₹${preview.lateDeductionTotal.toFixed(2)}`}
                      sub={`${preview.lateCount} late occurrence(s)`}
                    />
                    <Row label="Reimbursement" value={`+₹${preview.reimbursementTotal.toFixed(2)}`} />
                  </dl>
                  <div className="border-t pt-3">
                    <p className="text-xs text-muted-foreground">Net payable</p>
                    <p className="text-2xl font-bold tabular-nums">₹{preview.netPay.toFixed(2)}</p>
                  </div>
                  {preview.notes.late_tracking_unavailable && (
                    <p className="text-xs text-muted-foreground">{preview.notes.late_tracking_unavailable}</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {previewLoading ? "Computing…" : "Loading…"}
                </p>
              )}
            </section>
          )}

          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Manual adjustments</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-2 rounded-lg border p-3">
                <Label htmlFor="incentive">Incentive (₹)</Label>
                <Input
                  id="incentive"
                  type="number"
                  min="0"
                  step="0.01"
                  value={incentive}
                  onChange={(e) => setIncentive(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2 rounded-lg border p-3">
                <Label htmlFor="bonus">Bonus (₹)</Label>
                <Input
                  id="bonus"
                  type="number"
                  min="0"
                  step="0.01"
                  value={bonus}
                  onChange={(e) => setBonus(e.target.value)}
                />
                <Label htmlFor="bonusReason" className="text-xs text-muted-foreground">
                  Reason
                </Label>
                <Input id="bonusReason" value={bonusReason} onChange={(e) => setBonusReason(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2 rounded-lg border p-3">
                <Label htmlFor="otherAddition">Other addition (₹)</Label>
                <Input
                  id="otherAddition"
                  type="number"
                  min="0"
                  step="0.01"
                  value={otherAddition}
                  onChange={(e) => setOtherAddition(e.target.value)}
                />
                <Label htmlFor="otherAdditionReason" className="text-xs text-muted-foreground">
                  Reason
                </Label>
                <Input
                  id="otherAdditionReason"
                  value={otherAdditionReason}
                  onChange={(e) => setOtherAdditionReason(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2 rounded-lg border p-3">
                <Label htmlFor="otherDeduction">Other deduction (₹)</Label>
                <Input
                  id="otherDeduction"
                  type="number"
                  min="0"
                  step="0.01"
                  value={otherDeduction}
                  onChange={(e) => setOtherDeduction(e.target.value)}
                />
                <Label htmlFor="otherDeductionReason" className="text-xs text-muted-foreground">
                  Reason
                </Label>
                <Input
                  id="otherDeductionReason"
                  value={otherDeductionReason}
                  onChange={(e) => setOtherDeductionReason(e.target.value)}
                />
              </div>
            </div>
          </section>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <div>
            <Button type="submit" disabled={submitting || !employeeId}>
              {submitting ? "Generating…" : "Generate"}
            </Button>
          </div>
        </form>

        {generatedResult && (
          <div className="rounded-md border p-4 text-sm">
            <p className="mb-2 font-medium">Generated — net pay: ₹{generatedResult.netPay}</p>
            <Link
              href={`/payslips/${generatedResult.id}`}
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

function BreakdownStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
