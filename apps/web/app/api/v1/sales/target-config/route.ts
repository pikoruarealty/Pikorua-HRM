import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, isAdmin } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { getSalesTargetConfig } from "@/lib/sales/targets";
import { audit, clientIp } from "@/lib/audit";

// GET /api/v1/sales/target-config — Admin/HR; the org-wide defaults every
// sales rep's calls/site-visits/bookings targets resolve to unless a Lead has
// set a per-employee override (PATCH /employees/:id/sales-targets).
export async function GET() {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!FINANCE_ROLES.includes(session.role)) return failFor(ErrorCode.FORBIDDEN);

  const config = await getSalesTargetConfig();
  return ok(config);
}

// PUT /api/v1/sales/target-config — Admin only. Same versioning pattern as
// payroll/config: always INSERTS a new row so a past month's attainment
// reproduces the target that was actually in force then.
const putSchema = z.object({
  daily_call_target: z.coerce.number().int().min(1),
  monthly_site_visit_target: z.coerce.number().int().min(0),
  monthly_booking_target: z.coerce.number().int().min(0),
  auto_assign_daily_calls: z.coerce.boolean(),
  effective_from: z.coerce.date(),
});

export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!isAdmin(session.role)) {
    return failFor(ErrorCode.FORBIDDEN, "Only Admin can update sales target config.");
  }

  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return fail(ErrorCode.VALIDATION, "Invalid sales target config payload.", 422);
  }

  const created = await prisma.salesTargetConfig.create({
    data: {
      dailyCallTarget: parsed.data.daily_call_target,
      monthlySiteVisitTarget: parsed.data.monthly_site_visit_target,
      monthlyBookingTarget: parsed.data.monthly_booking_target,
      autoAssignDailyCalls: parsed.data.auto_assign_daily_calls,
      effectiveFrom: parsed.data.effective_from,
    },
  });

  await audit({
    action: "sales_target_config.update",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "sales_target_config",
    entityId: created.id,
    metadata: {
      daily_call_target: parsed.data.daily_call_target,
      monthly_site_visit_target: parsed.data.monthly_site_visit_target,
      monthly_booking_target: parsed.data.monthly_booking_target,
      auto_assign_daily_calls: parsed.data.auto_assign_daily_calls,
      effective_from: parsed.data.effective_from.toISOString().slice(0, 10),
    },
    ip: clientIp(req),
  });

  return ok(created);
}
