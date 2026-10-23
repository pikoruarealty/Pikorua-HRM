import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, isAdmin } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { getLatestPayrollConfig } from "@/lib/payroll/config";
import { audit, clientIp } from "@/lib/audit";
import { DEFAULT_WFH_WEEKLY_CAP_HOURS } from "@/lib/attendance/wfh-hours";

// Track A. GET /api/v1/payroll/config — Admin/HR; current (latest
// effective_from) rates. Since 2026-07-17 the only configurable rate is the
// late-deduction percentage — half-day/unpaid-leave/absent deductions are
// fixed fractions of a day's pay (base_salary / 30), computed directly in
// lib/payroll/calc.ts, not stored here.
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
  late_deduction_percent: z.coerce.number().min(0).max(100),
  late_grace_minutes: z.coerce.number().int().min(0).max(120),
  // Weekly cap on the WFH hours that count toward a WFH-hours target (2026-10-24).
  // Optional so an older client that only knows the two late-arrival fields keeps
  // working — omitted means "keep the cap that is in force now".
  wfh_weekly_cap_hours: z.coerce.number().positive().max(168).optional(),
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

  const wfhCap =
    parsed.data.wfh_weekly_cap_hours ??
    Number((await getLatestPayrollConfig())?.wfhWeeklyCapHours ?? DEFAULT_WFH_WEEKLY_CAP_HOURS);

  const created = await prisma.payrollConfig.create({
    data: {
      lateDeductionPercent: parsed.data.late_deduction_percent,
      lateGraceMinutes: parsed.data.late_grace_minutes,
      wfhWeeklyCapHours: wfhCap,
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
      late_deduction_percent: parsed.data.late_deduction_percent,
      late_grace_minutes: parsed.data.late_grace_minutes,
      wfh_weekly_cap_hours: wfhCap,
      effective_from: parsed.data.effective_from.toISOString().slice(0, 10),
    },
    ip: clientIp(req),
  });

  return ok(created);
}
