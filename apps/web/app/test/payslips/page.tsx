"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "../_lib/api";

// Milestone 4 (integration) test surface. Payslip generation is Track A code,
// but it pulls three Track B cross-track helpers — reimbursement total,
// unpaid-leave day count, and Employee-of-the-Month ref — so generating a
// payslip here is the end-to-end proof that the Phase 0 contract works.
// Admin/HR only (golden RBAC rule: salary data is finance-only, ever).

type Employee = { id: string; fullName: string; role: string };

type Payslip = {
  id: string;
  employeeId: string;
  periodMonth: number;
  periodYear: number;
  baseSalary: string;
  incentiveAmount: string;
  bonusAmount: string;
  reimbursementTotal: string;
  unpaidLeaveCount: number;
  lateCount: number;
  halfDayCount: number;
  standardDeductionTotal: string;
  employeeOfMonthRef: boolean;
  netPay: string;
  status: string;
  employee?: { id: string; fullName: string };
  notes?: Record<string, string | undefined>;
};

const now = new Date();

export default function PayslipsPage() {
  const [me, setMe] = useState<{ role: string } | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [month, setMonth] = useState(String(now.getUTCMonth() + 1));
  const [year, setYear] = useState(String(now.getUTCFullYear()));
  const [incentive, setIncentive] = useState("0");
  const [bonus, setBonus] = useState("0");
  const [result, setResult] = useState<Payslip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    const res = await apiFetch<Payslip[]>("/payslips");
    if (res.data) setPayslips(res.data);
  }

  useEffect(() => {
    apiFetch<{ role: string }>("/auth/me").then((res) => {
      if (res.data) setMe({ role: res.data.role });
    });
    fetch("/api/test/employees").then((r) => r.json()).then((json) => {
      if (json.data) setEmployees(json.data);
    });
    refresh();
  }, []);

  const isFinance = me?.role === "admin" || me?.role === "hr";

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setLoading(true);
    const res = await apiFetch<Payslip>("/payslips/generate", {
      method: "POST",
      body: JSON.stringify({
        employee_id: employeeId,
        month: Number(month),
        year: Number(year),
        incentive_amount: Number(incentive),
        bonus_amount: Number(bonus),
      }),
    });
    setLoading(false);
    if (res.error) {
      setError(`${res.error.code}: ${res.error.message}`);
      return;
    }
    setResult(res.data);
    refresh();
  }

  if (me && !isFinance) {
    return (
      <p className="text-sm text-muted-foreground">
        Payslips are Admin/HR only (golden RBAC rule). Log in as admin or hr to use this page.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Generate payslip (POST /payslips/generate)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Cross-track check: the generated payslip below should reflect the
            employee&apos;s approved reimbursements (from Requests), approved
            unpaid-leave days, and Employee-of-the-Month badge. Set those up via
            the Requests / Recognition pages first, then generate here.
          </p>
          <form onSubmit={generate} className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label>Employee</Label>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                required
              >
                <option value="">Select an employee…</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.fullName} ({emp.role})</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Month (1-12)</Label>
              <Input type="number" value={month} onChange={(e) => setMonth(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Year</Label>
              <Input type="number" value={year} onChange={(e) => setYear(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Incentive</Label>
              <Input type="number" value={incentive} onChange={(e) => setIncentive(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Bonus</Label>
              <Input type="number" value={bonus} onChange={(e) => setBonus(e.target.value)} />
            </div>
            {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
            <Button type="submit" disabled={loading} className="w-fit sm:col-span-2">
              {loading ? "Generating…" : "Generate"}
            </Button>
          </form>

          {result && (
            <div className="mt-4 flex flex-col gap-2 rounded border p-3 text-sm">
              <p className="font-medium">Generated payslip</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-muted-foreground sm:grid-cols-3">
                <span>Base: ₹{result.baseSalary}</span>
                <span>Incentive: ₹{result.incentiveAmount}</span>
                <span>Bonus: ₹{result.bonusAmount}</span>
                <span className="font-medium text-foreground">Reimbursement: ₹{result.reimbursementTotal}</span>
                <span className="font-medium text-foreground">Unpaid-leave days: {result.unpaidLeaveCount}</span>
                <span className="font-medium text-foreground">EoM: {result.employeeOfMonthRef ? "yes" : "no"}</span>
                <span>Late: {result.lateCount}</span>
                <span>Half-days: {result.halfDayCount}</span>
                <span>Std deductions: ₹{result.standardDeductionTotal}</span>
                <span className="col-span-2 font-semibold text-foreground sm:col-span-3">Net pay: ₹{result.netPay}</span>
              </div>
              {result.notes && Object.values(result.notes).some(Boolean) && (
                <ul className="ml-4 list-disc text-xs text-amber-600 dark:text-amber-500">
                  {Object.entries(result.notes)
                    .filter(([, v]) => v)
                    .map(([k, v]) => <li key={k}>{v}</li>)}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payslips (GET /payslips)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {payslips.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
          {payslips.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded border p-3 text-sm">
              <span>
                {p.employee?.fullName ?? p.employeeId} — {p.periodMonth}/{p.periodYear} · net ₹{p.netPay}
                <span className="text-muted-foreground">
                  {" "}(reimb ₹{p.reimbursementTotal}, unpaid {p.unpaidLeaveCount}d{p.employeeOfMonthRef ? ", EoM" : ""})
                </span>
              </span>
              <Badge variant="outline">{p.status}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
