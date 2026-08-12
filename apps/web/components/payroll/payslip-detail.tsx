"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PayslipVisual } from "@/components/payroll/payslip-visual";

type PayslipDetail = {
  id: string;
  employee: {
    id: string;
    fullName: string;
    email?: string;
    role?: string;
    dateOfJoining?: string | null;
    department?: { name: string } | null;
  };
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
  absentCount: number;
  presentCount: number;
  paidLeaveCount: number;
  holidayCount: number;
  compensationCount: number;
  earnedBasePay: string;
  lateDeductionTotal: string;
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

async function getJson(res: Response) {
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data;
}

export function PayslipDetail({ id, canFinalize }: { id: string; canFinalize: boolean }) {
  const [payslip, setPayslip] = useState<PayslipDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await getJson(await fetch(`/api/v1/payslips/${id}`));
      setPayslip(data);
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
      <div className="flex flex-wrap items-center justify-between gap-3">
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

      {/* Visual preview of the actual document — draft or finalized — with
          Download following it (finalized only; drafts have nothing to
          export yet). */}
      <PayslipVisual
        payslip={{
          employee: {
            fullName: payslip.employee.fullName,
            email: payslip.employee.email,
            role: payslip.employee.role,
            dateOfJoining: payslip.employee.dateOfJoining ?? null,
            departmentName: payslip.employee.department?.name ?? null,
          },
          periodMonth: payslip.periodMonth,
          periodYear: payslip.periodYear,
          baseSalary: Number(payslip.baseSalary),
          earnedBasePay: Number(payslip.earnedBasePay),
          presentCount: payslip.presentCount,
          halfDayCount: payslip.halfDayCount,
          paidLeaveCount: payslip.paidLeaveCount,
          holidayCount: payslip.holidayCount,
          compensationCount: payslip.compensationCount,
          unpaidLeaveCount: payslip.unpaidLeaveCount,
          absentCount: payslip.absentCount,
          lateCount: payslip.lateCount,
          incentiveAmount: Number(payslip.incentiveAmount),
          bonusAmount: Number(payslip.bonusAmount),
          bonusReason: payslip.bonusReason,
          otherAdditionAmount: payslip.otherAdditionAmount !== null ? Number(payslip.otherAdditionAmount) : null,
          otherAdditionReason: payslip.otherAdditionReason,
          lateDeductionTotal: Number(payslip.lateDeductionTotal),
          otherDeductionAmount: payslip.otherDeductionAmount !== null ? Number(payslip.otherDeductionAmount) : null,
          otherDeductionReason: payslip.otherDeductionReason,
          reimbursementTotal: Number(payslip.reimbursementTotal),
          netPay: Number(payslip.netPay),
          generatedAt: payslip.generatedAt,
          status: payslip.status,
        }}
      />

      {payslip.status === "finalized" && (
        <div className="mx-auto">
          <a
            href={`/api/v1/payslips/${id}/pdf`}
            download
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            Download PDF
          </a>
        </div>
      )}
    </div>
  );
}
