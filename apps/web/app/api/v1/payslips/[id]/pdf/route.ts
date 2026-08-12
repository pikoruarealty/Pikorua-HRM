import { renderToBuffer } from "@react-pdf/renderer";
import { PayslipStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/rbac";
import { failFor, ErrorCode } from "@/lib/api/response";
import { audit, clientIp } from "@/lib/audit";
import { PayslipPdfDocument } from "@/lib/payroll/payslip-pdf";

// Track A (owner request, 2026-08-07). GET /api/v1/payslips/:id/pdf —
// Admin/HR (any payslip) or the employee viewing their own. Restricted to
// finalized payslips only — matches the existing self-view GET's rule
// (drafts are never exposed to the employee, and exporting a draft as a
// downloadable PDF would misrepresent it as final). Renders server-side via
// @react-pdf/renderer, no headless browser.
export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const payslip = await prisma.payslip.findUnique({
    where: { id: params.id },
    include: {
      employee: {
        select: {
          fullName: true,
          email: true,
          role: true,
          dateOfJoining: true,
          department: { select: { name: true } },
        },
      },
    },
  });
  if (!payslip) return failFor(ErrorCode.NOT_FOUND, "Payslip not found.");

  const isFinance = FINANCE_ROLES.includes(session.role);
  const isSelf = session.employeeId === payslip.employeeId;
  if (!isFinance && !isSelf) return failFor(ErrorCode.FORBIDDEN);
  if (payslip.status !== PayslipStatus.finalized) {
    return failFor(ErrorCode.CONFLICT, "Only finalized payslips can be exported as PDF.");
  }

  const buffer = await renderToBuffer(
    PayslipPdfDocument({
      employee: {
        fullName: payslip.employee.fullName,
        email: payslip.employee.email,
        role: payslip.employee.role,
        dateOfJoining: payslip.employee.dateOfJoining?.toISOString() ?? null,
        departmentName: payslip.employee.department?.name ?? null,
      },
      payslip: {
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
        generatedAt: payslip.generatedAt.toISOString(),
      },
    }),
  );

  await audit({
    action: "payslip.export_pdf",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "payslip",
    entityId: params.id,
    metadata: {
      employee_id: payslip.employeeId,
      period: `${payslip.periodYear}-${payslip.periodMonth}`,
      self_export: isSelf && !isFinance,
    },
    ip: clientIp(req),
  });

  const slugName = payslip.employee.fullName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const filename = `payslip-${slugName || "employee"}-${payslip.periodYear}-${String(payslip.periodMonth).padStart(2, "0")}.pdf`;
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
