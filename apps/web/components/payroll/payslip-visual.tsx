import Image from "next/image";
import { COMPANY_INFO } from "@/lib/payroll/company-info";
import { formatDate } from "@/lib/format-date";

// On-page visual rendering of a payslip — mirrors the layout of
// lib/payroll/payslip-pdf.tsx (letterhead → employee info → attendance
// summary → earnings/deductions tables → net pay) but as themed HTML rather
// than a PDF, so a draft can be reviewed as "the actual document" before it's
// finalized/exportable. Shown for both draft and finalized payslips;
// PayslipDetail places the Download PDF button after this, finalized-only.

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function rupees(n: number) {
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export type PayslipVisualInput = {
  employee: {
    fullName: string;
    email?: string;
    role?: string;
    dateOfJoining?: string | null;
    departmentName?: string | null;
  };
  periodMonth: number;
  periodYear: number;
  baseSalary: number;
  earnedBasePay: number;
  presentCount: number;
  halfDayCount: number;
  paidLeaveCount: number;
  holidayCount: number;
  compensationCount: number;
  unpaidLeaveCount: number;
  absentCount: number;
  lateCount: number;
  incentiveAmount: number;
  bonusAmount: number;
  bonusReason: string | null;
  otherAdditionAmount: number | null;
  otherAdditionReason: string | null;
  lateDeductionTotal: number;
  otherDeductionAmount: number | null;
  otherDeductionReason: string | null;
  reimbursementTotal: number;
  netPay: number;
  generatedAt: string;
  status: "draft" | "finalized";
};

export function PayslipVisual({ payslip }: { payslip: PayslipVisualInput }) {
  const monthLabel = `${MONTH_NAMES[payslip.periodMonth - 1]} ${payslip.periodYear}`;

  const earnings = [
    { label: "Earned base pay", amount: payslip.earnedBasePay },
    { label: "Incentive", amount: payslip.incentiveAmount },
    {
      label: "Bonus" + (payslip.bonusReason ? ` (${payslip.bonusReason})` : ""),
      amount: payslip.bonusAmount,
    },
    ...(payslip.otherAdditionAmount
      ? [
          {
            label: "Other addition" + (payslip.otherAdditionReason ? ` (${payslip.otherAdditionReason})` : ""),
            amount: payslip.otherAdditionAmount,
          },
        ]
      : []),
    { label: "Reimbursement", amount: payslip.reimbursementTotal },
  ].filter((r) => r.amount !== 0 || r.label === "Earned base pay");

  const deductions = [
    { label: "Late deduction", amount: payslip.lateDeductionTotal },
    ...(payslip.otherDeductionAmount
      ? [
          {
            label: "Other deduction" + (payslip.otherDeductionReason ? ` (${payslip.otherDeductionReason})` : ""),
            amount: payslip.otherDeductionAmount,
          },
        ]
      : []),
  ].filter((r) => r.amount !== 0);

  const totalEarnings = earnings.reduce((sum, r) => sum + r.amount, 0);
  const totalDeductions = deductions.reduce((sum, r) => sum + r.amount, 0);

  return (
    // Deliberately a fixed white "paper" look (not theme-aware) — this is a
    // preview of the literal downloadable document, not app chrome, so it
    // should read the same regardless of the viewer's light/dark setting
    // (same reasoning as Google Docs/Word always showing a white page in
    // dark mode). Uses the same black-text letterhead logo as the PDF.
    <div className="mx-auto w-full max-w-2xl overflow-hidden rounded-lg border border-neutral-300 bg-white text-neutral-900 shadow-sm dark:border-neutral-700">
      {payslip.status === "draft" && (
        <div className="border-b border-amber-300 bg-amber-100 px-6 py-2 text-center text-xs font-semibold uppercase tracking-wide text-amber-800">
          Draft — not yet finalized
        </div>
      )}
      <div className="p-6 sm:p-8">
        {/* Letterhead — the logo image already contains the name + tagline,
            so it stands alone (bigger, above the address) instead of
            repeating them as text next to it. The source PNG bakes in a lot
            of transparent padding above/below the mark itself (it's a square
            320x320 canvas but the visible content is only the ~62px band
            from y=127 to y=189) — rendering it at its native size leaves a
            huge blank gap before the address, so we window/crop to just that
            band via a fixed-size overflow-hidden wrapper instead. */}
        <div className="flex flex-col items-center gap-1.5 border-b border-neutral-200 pb-3 text-center">
          <div className="relative h-[47px] w-[240px] overflow-hidden">
            <Image
              src={COMPANY_INFO.logoPath}
              alt={`${COMPANY_INFO.name} — ${COMPANY_INFO.tagline}`}
              width={240}
              height={240}
              className="absolute left-0 top-[-95px]"
            />
          </div>
          <p className="text-[11px] leading-snug text-neutral-500">
            {COMPANY_INFO.address}
            <br />
            {COMPANY_INFO.phone} · {COMPANY_INFO.email}
          </p>
        </div>

        <p className="my-4 text-center text-sm font-bold uppercase tracking-wide">
          Payslip — {monthLabel}
        </p>

        {/* Employee info */}
        <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <VisualField label="Name" value={payslip.employee.fullName} />
          {payslip.employee.email && <VisualField label="Email" value={payslip.employee.email} />}
          {payslip.employee.role && (
            <VisualField label="Role" value={payslip.employee.role.replace(/_/g, " ")} />
          )}
          <VisualField label="Department" value={payslip.employee.departmentName ?? "—"} />
          <VisualField
            label="Date of joining"
            value={
              payslip.employee.dateOfJoining ? formatDate(payslip.employee.dateOfJoining) : "—"
            }
          />
        </div>

        {/* Attendance summary */}
        <div className="mb-4">
          <p className="mb-2 text-xs font-semibold text-neutral-500">Attendance summary</p>
          <div className="grid grid-cols-4 gap-2 text-sm">
            <VisualStat label="Present" value={payslip.presentCount} />
            <VisualStat label="Half-day" value={payslip.halfDayCount} />
            <VisualStat label="Paid leave" value={payslip.paidLeaveCount} />
            <VisualStat label="Holidays" value={payslip.holidayCount} />
            <VisualStat label="Compensation" value={payslip.compensationCount} />
            <VisualStat label="Unpaid leave" value={payslip.unpaidLeaveCount} />
            <VisualStat label="Absent" value={payslip.absentCount} />
            <VisualStat label="Late" value={payslip.lateCount} />
          </div>
        </div>

        {/* Earnings */}
        <VisualTable title="Earnings" rows={earnings} total={totalEarnings} totalLabel="Total earnings" />

        {/* Deductions */}
        {deductions.length > 0 && (
          <VisualTable title="Deductions" rows={deductions} total={totalDeductions} totalLabel="Total deductions" />
        )}

        {/* Net pay */}
        <div className="mt-4 flex items-center justify-between rounded-md bg-neutral-100 px-4 py-3">
          <span className="text-sm font-semibold">Net pay</span>
          <span className="text-xl font-bold tabular-nums">{rupees(payslip.netPay)}</span>
        </div>

        <p className="mt-4 border-t border-neutral-200 pt-3 text-center text-[11px] text-neutral-500">
          This is a computer-generated payslip and does not require a signature. Generated on{" "}
          {formatDate(payslip.generatedAt)} via Pikorua HRM.
        </p>
      </div>
    </div>
  );
}

function VisualField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

function VisualStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-neutral-200 px-2 py-1.5 text-center">
      <p className="text-[10px] text-neutral-500">{label}</p>
      <p className="font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function VisualTable({
  title,
  rows,
  total,
  totalLabel,
}: {
  title: string;
  rows: { label: string; amount: number }[];
  total: number;
  totalLabel: string;
}) {
  return (
    <div className="mb-4">
      <p className="mb-2 text-xs font-semibold text-neutral-500">{title}</p>
      <div className="overflow-hidden rounded-md border border-neutral-200 text-sm">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex items-center justify-between border-b border-neutral-200 px-3 py-1.5 last:border-b-0"
          >
            <span>{r.label}</span>
            <span className="tabular-nums">{rupees(r.amount)}</span>
          </div>
        ))}
        <div className="flex items-center justify-between bg-neutral-100 px-3 py-1.5 font-medium">
          <span>{totalLabel}</span>
          <span className="tabular-nums">{rupees(total)}</span>
        </div>
      </div>
    </div>
  );
}
