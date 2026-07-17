"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type PayslipDetail = {
  id: string;
  employee: { id: string; fullName: string };
  periodMonth: number;
  periodYear: number;
  baseSalary: string;
  incentiveAmount: string;
  bonusAmount: string;
  bonusReason: string | null;
  otherAdditionAmount: string | null;
  otherAdditionReason: string | null;
  otherDeductionAmount: string | null;
  otherDeductionReason: string | null;
  lateCount: number;
  unpaidLeaveCount: number;
  halfDayCount: number;
  standardDeductionTotal: string;
  reimbursementTotal: string;
  employeeOfMonthRef: boolean;
  netPay: string;
  status: "draft" | "finalized";
  generatedAt: string;
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type AttendanceBreakdown = {
  present_days: number;
  half_days: number;
  absent_days: number;
  paid_leave_days: number;
  compensation_days: number;
  holiday_days: number;
};

async function getJson(res: Response) {
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data;
}

export function PayslipDetail({ id, canFinalize }: { id: string; canFinalize: boolean }) {
  const [payslip, setPayslip] = useState<PayslipDetail | null>(null);
  const [breakdown, setBreakdown] = useState<AttendanceBreakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data: PayslipDetail = await getJson(await fetch(`/api/v1/payslips/${id}`));
      setPayslip(data);
      try {
        const b = await getJson(
          await fetch(
            `/api/v1/attendance/${data.employee.id}/summary?month=${data.periodMonth}&year=${data.periodYear}`,
          ),
        );
        setBreakdown(b);
      } catch {
        setBreakdown(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load payslip.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function finalize() {
    setFinalizing(true);
    setError(null);
    try {
      await getJson(await fetch(`/api/v1/payslips/${id}/finalize`, { method: "PATCH" }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to finalize.");
    } finally {
      setFinalizing(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!payslip) return null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/payslips" className="text-sm text-muted-foreground hover:underline">
          ← Payslips
        </Link>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {payslip.employee.fullName} — {MONTH_NAMES[payslip.periodMonth - 1]} {payslip.periodYear}
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant={payslip.status === "finalized" ? "default" : "outline"}>
              {payslip.status}
            </Badge>
            {payslip.employeeOfMonthRef && <Badge variant="secondary">🏆 Employee of the Month</Badge>}
          </div>
        </div>
        {canFinalize && payslip.status === "draft" && (
          <Button onClick={finalize} disabled={finalizing}>
            {finalizing ? "Finalizing…" : "Finalize"}
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
            <Row label="Base salary" value={`₹${payslip.baseSalary}`} />
            <Row label="Incentive" value={`+₹${payslip.incentiveAmount}`} />
            <Row
              label="Bonus"
              value={`+₹${payslip.bonusAmount}`}
              sub={payslip.bonusReason ?? undefined}
            />
            {payslip.otherAdditionAmount && (
              <Row
                label="Other addition"
                value={`+₹${payslip.otherAdditionAmount}`}
                sub={payslip.otherAdditionReason ?? undefined}
              />
            )}
            <Row label="Reimbursement" value={`+₹${payslip.reimbursementTotal}`} />
            <Row
              label="Standard deductions"
              value={`−₹${payslip.standardDeductionTotal}`}
              sub={`late ${payslip.lateCount} · half-day ${payslip.halfDayCount} · unpaid leave ${payslip.unpaidLeaveCount}`}
            />
            {payslip.otherDeductionAmount && (
              <Row
                label="Other deduction"
                value={`−₹${payslip.otherDeductionAmount}`}
                sub={payslip.otherDeductionReason ?? undefined}
              />
            )}
            <div className="col-span-full mt-2 border-t pt-3">
              <dt className="text-muted-foreground">Net pay</dt>
              <dd className="text-xl font-bold">₹{payslip.netPay}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {breakdown && (
        <Card>
          <CardHeader>
            <CardTitle>Attendance for this period</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Row label="Present" value={String(breakdown.present_days)} />
              <Row label="Half-day" value={String(breakdown.half_days)} />
              <Row label="Absent" value={String(breakdown.absent_days)} />
              <Row label="Paid leave" value={String(breakdown.paid_leave_days)} />
              <Row label="Compensation" value={String(breakdown.compensation_days)} />
              <Row label="Holidays" value={String(breakdown.holiday_days)} />
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              Informational only — re-derived from current attendance/leave/holiday data, not stored
              on the payslip itself (the standard-deductions figure above is what was actually used
              at generation time).
            </p>
          </CardContent>
        </Card>
      )}
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
