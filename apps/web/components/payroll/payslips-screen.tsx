"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Employee = { id: string; fullName: string; email: string; phone: string | null };

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
  const router = useRouter();
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
                  <TableRow
                    key={p.id}
                    onClick={() => router.push(`/payslips/${p.id}`)}
                    className="cursor-pointer hover:bg-muted/50"
                  >
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
                      {/* Admin actions live inside a clickable row — stop the
                          click from also navigating to the detail page. */}
                      <span className="flex items-center gap-2">
                        {isAdmin && p.status === "finalized" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              unfinalize(p.id);
                            }}
                          >
                            Unfinalize
                          </Button>
                        )}
                        {isAdmin && p.status === "draft" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteDraft(p.id);
                            }}
                          >
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
                <SearchableSelect
                  value={employeeId || undefined}
                  onChange={setEmployeeId}
                  placeholder="Select…"
                  searchPlaceholder="Search name, email, phone…"
                  items={employees.map((e) => ({
                    value: e.id,
                    label: e.fullName,
                    sublabel: e.email,
                    keywords: e.phone ? [e.phone] : [],
                  }))}
                />
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

          {preview && (
            <PayslipComputation
              preview={preview}
              incentive={incentive}
              bonus={bonus}
              otherAddition={otherAddition}
              otherDeduction={otherDeduction}
            />
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

function rupees(n: number) {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Shows exactly where the net payable figure comes from: how each
 *  attendance category converts to "payable days", how that becomes earned
 *  base pay, and every addition/deduction on top of it down to net pay.
 *  Separate from the raw day-count tiles above (per Umang's ask) — this is
 *  the "show your work" section. */
function PayslipComputation({
  preview,
  incentive,
  bonus,
  otherAddition,
  otherDeduction,
}: {
  preview: PayslipPreview;
  incentive: string;
  bonus: string;
  otherAddition: string;
  otherDeduction: string;
}) {
  const incentiveNum = Number(incentive) || 0;
  const bonusNum = Number(bonus) || 0;
  const otherAdditionNum = Number(otherAddition) || 0;
  const otherDeductionNum = Number(otherDeduction) || 0;

  const payableRows = [
    { label: "Present days", days: preview.presentDays, weight: 1 },
    { label: "Half-days", days: preview.halfDays, weight: 0.5 },
    { label: "Paid leave", days: preview.paidLeaveDays, weight: 1 },
    { label: "Holidays", days: preview.holidayDays, weight: 1 },
    { label: "Compensation days", days: preview.compensationDays, weight: 1 },
  ];
  const totalPayableDays = payableRows.reduce((sum, r) => sum + r.days * r.weight, 0);

  // Earned base pay always shows (it's the anchor figure) even when zero;
  // every other line is only shown when it actually affects the total, so a
  // plain payslip with no manual amounts/late/reimbursement isn't cluttered
  // with a wall of "+₹0.00" rows.
  const allLedgerRows: { label: string; amount: number; sign: "+" | "−" }[] = [
    { label: "Earned base pay", amount: preview.earnedBasePay, sign: "+" },
    { label: "Incentive", amount: incentiveNum, sign: "+" },
    { label: "Bonus", amount: bonusNum, sign: "+" },
    { label: "Other addition", amount: otherAdditionNum, sign: "+" },
    { label: "Late deduction", amount: preview.lateDeductionTotal, sign: "−" },
    { label: "Other deduction", amount: otherDeductionNum, sign: "−" },
    { label: "Reimbursement", amount: preview.reimbursementTotal, sign: "+" },
  ];
  const ledgerRows = allLedgerRows.filter((r) => r.label === "Earned base pay" || r.amount !== 0);

  return (
    <section className="flex flex-col gap-4 rounded-lg border p-4">
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground">How this is calculated</h3>
        <p className="text-xs text-muted-foreground">
          Every present/half-day/paid-leave/holiday/compensation day is paid; absent and unpaid-leave
          days are simply not paid (no separate deduction for them).
        </p>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">Payable days</p>

        {/* Below sm: a stacked list — a 4-column table gets cramped/needs
            horizontal scroll on phone widths, so avoid it entirely there. */}
        <div className="flex flex-col divide-y rounded-md border text-sm sm:hidden">
          {payableRows.map((r) => (
            <div key={r.label} className="flex items-center justify-between px-3 py-2">
              <span className="text-muted-foreground">{r.label}</span>
              <span className="tabular-nums">
                {r.days} × {r.weight} = {r.days * r.weight}
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between bg-muted/50 px-3 py-2">
            <span className="font-medium">Total payable days</span>
            <span className="font-medium tabular-nums">{totalPayableDays}</span>
          </div>
        </div>

        {/* sm and up: the full table. */}
        <div className="hidden sm:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-9 px-3">Category</TableHead>
                <TableHead className="h-9 px-3 text-right">Days</TableHead>
                <TableHead className="h-9 px-3 text-right">Weight</TableHead>
                <TableHead className="h-9 px-3 text-right">Payable</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payableRows.map((r) => (
                <TableRow key={r.label}>
                  <TableCell className="p-3">{r.label}</TableCell>
                  <TableCell className="p-3 text-right tabular-nums">{r.days}</TableCell>
                  <TableCell className="p-3 text-right tabular-nums">×{r.weight}</TableCell>
                  <TableCell className="p-3 text-right tabular-nums">{r.days * r.weight}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="p-3 font-medium" colSpan={3}>
                  Total payable days
                </TableCell>
                <TableCell className="p-3 text-right font-medium tabular-nums">{totalPayableDays}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Earned base pay = {totalPayableDays} payable days × ₹{rupees(preview.perDayRate)}/day (base
          salary ₹{rupees(preview.baseSalary)} ÷ 30) = ₹{rupees(preview.earnedBasePay)}
        </p>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">From earned pay to net payable</p>
        <div className="flex flex-col divide-y rounded-md border text-sm">
          {ledgerRows.map((r) => (
            <div key={r.label} className="flex items-center justify-between px-3 py-2">
              <span className="text-muted-foreground">{r.label}</span>
              <span className="tabular-nums">
                {r.sign}₹{rupees(r.amount)}
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between bg-muted/50 px-3 py-2.5">
            <span className="font-semibold">Net payable</span>
            <span className="text-lg font-bold tabular-nums">₹{rupees(preview.netPay)}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
