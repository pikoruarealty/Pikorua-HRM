import { z } from "zod";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { computePayslipPreview } from "@/lib/payroll/payslip-preview";

// Track A (2026-07-17). POST /api/v1/payslips/preview — Admin/HR only
// (golden RBAC rule: salary data is Admin/HR-only, same gate as generate).
// Read-only — computes the same breakdown/net-pay math as
// POST /payslips/generate without persisting anything or checking for an
// existing payslip, so the Generate Payslip screen can show a live
// projection as soon as an employee/period is picked, before the user
// commits. Safe to call repeatedly (e.g. on every manual-field keystroke).
const bodySchema = z.object({
  employee_id: z.string().uuid(),
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
  incentive_amount: z.coerce.number().nonnegative().default(0),
  bonus_amount: z.coerce.number().nonnegative().default(0),
  other_addition_amount: z.coerce.number().nonnegative().optional(),
  other_deduction_amount: z.coerce.number().nonnegative().optional(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return failFor(ErrorCode.UNAUTHENTICATED);
  }
  if (!FINANCE_ROLES.includes(session.role)) {
    return failFor(ErrorCode.FORBIDDEN);
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return fail(ErrorCode.VALIDATION, "Invalid payslip preview payload.", 422);
  }
  const {
    employee_id: employeeId,
    month,
    year,
    incentive_amount: incentiveAmount,
    bonus_amount: bonusAmount,
    other_addition_amount: otherAdditionAmount,
    other_deduction_amount: otherDeductionAmount,
  } = parsed.data;

  const preview = await computePayslipPreview({
    employeeId,
    month,
    year,
    incentiveAmount,
    bonusAmount,
    otherAdditionAmount: otherAdditionAmount ?? 0,
    otherDeductionAmount: otherDeductionAmount ?? 0,
  });
  if (!preview.ok) {
    return fail(preview.code, preview.message, preview.status);
  }

  const { ok: _ok, ...result } = preview;
  return ok(result);
}
