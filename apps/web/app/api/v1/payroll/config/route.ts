import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, isAdmin } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { getLatestPayrollConfig } from "@/lib/payroll/config";
import { audit, clientIp } from "@/lib/audit";

// Track A. GET /api/v1/payroll/config — Admin/HR; current (latest
// effective_from) flat deduction rates.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return failFor(ErrorCode.UNAUTHENTICATED);
  }
  if (!FINANCE_ROLES.includes(session.role)) {
    return failFor(ErrorCode.FORBIDDEN);
  }

  const config = await getLatestPayrollConfig();
  return ok(config);
}

// PUT /api/v1/payroll/config — Admin only. Always INSERTS a new versioned
// row (never updates/overwrites an existing one) so past payslips stay
// reproducible against the rates that were effective when they were
// generated (SCHEMA.md §4).
const putSchema = z.object({
  late_deduction_flat: z.coerce.number().nonnegative(),
  unpaid_leave_deduction_flat: z.coerce.number().nonnegative(),
  half_day_deduction_flat: z.coerce.number().nonnegative(),
  effective_from: z.coerce.date(),
});

export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) {
    return failFor(ErrorCode.UNAUTHENTICATED);
  }
  if (!isAdmin(session.role)) {
    return failFor(ErrorCode.FORBIDDEN, "Only Admin can update payroll config.");
  }

  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return fail(ErrorCode.VALIDATION, "Invalid payroll config payload.", 422);
  }

  const created = await prisma.payrollConfig.create({
    data: {
      lateDeductionFlat: parsed.data.late_deduction_flat,
      unpaidLeaveDeductionFlat: parsed.data.unpaid_leave_deduction_flat,
      halfDayDeductionFlat: parsed.data.half_day_deduction_flat,
      effectiveFrom: parsed.data.effective_from,
    },
  });

  await audit({
    action: "payroll_config.update",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "payroll_config",
    entityId: created.id,
    metadata: {
      late: parsed.data.late_deduction_flat,
      unpaid_leave: parsed.data.unpaid_leave_deduction_flat,
      half_day: parsed.data.half_day_deduction_flat,
      effective_from: parsed.data.effective_from.toISOString().slice(0, 10),
    },
    ip: clientIp(req),
  });

  return ok(created);
}
