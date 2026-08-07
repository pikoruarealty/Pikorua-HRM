import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, isAdmin } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { getLatestLeaveConfig } from "@/lib/leave/config";
import { audit, clientIp } from "@/lib/audit";

// Owner request, 2026-08-07. GET /api/v1/leave-config — Admin/HR; current
// (latest effective_from) paid-leave allowance.
export async function GET() {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!FINANCE_ROLES.includes(session.role)) return failFor(ErrorCode.FORBIDDEN);

  const config = await getLatestLeaveConfig();
  return ok(config);
}

// PUT /api/v1/leave-config — Admin only. Always INSERTS a new versioned row
// (never updates/overwrites), mirroring payroll_config, so a balance
// computed for a past period reflects the allowance in force at the time.
const putSchema = z.object({
  paid_leaves_per_month: z.coerce.number().int().min(0).max(31),
  paid_leaves_per_year: z.coerce.number().int().min(0).max(366),
  part_time_paid_leaves_per_month: z.coerce.number().int().min(0).max(31).optional(),
  part_time_paid_leaves_per_year: z.coerce.number().int().min(0).max(366).optional(),
  intern_paid_leaves_per_month: z.coerce.number().int().min(0).max(31).optional(),
  intern_paid_leaves_per_year: z.coerce.number().int().min(0).max(366).optional(),
  effective_from: z.coerce.date(),
});

export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!isAdmin(session.role)) return failFor(ErrorCode.FORBIDDEN, "Only Admin can update leave config.");

  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return fail(ErrorCode.VALIDATION, "Invalid leave config payload.", 422);
  }

  const created = await prisma.leaveConfig.create({
    data: {
      paidLeavesPerMonth: parsed.data.paid_leaves_per_month,
      paidLeavesPerYear: parsed.data.paid_leaves_per_year,
      partTimePaidLeavesPerMonth: parsed.data.part_time_paid_leaves_per_month ?? parsed.data.paid_leaves_per_month,
      partTimePaidLeavesPerYear: parsed.data.part_time_paid_leaves_per_year ?? parsed.data.paid_leaves_per_year,
      internPaidLeavesPerMonth: parsed.data.intern_paid_leaves_per_month ?? parsed.data.paid_leaves_per_month,
      internPaidLeavesPerYear: parsed.data.intern_paid_leaves_per_year ?? parsed.data.paid_leaves_per_year,
      effectiveFrom: parsed.data.effective_from,
    },
  });

  await audit({
    action: "leave_config.update",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "leave_config",
    entityId: created.id,
    metadata: {
      paid_leaves_per_month: parsed.data.paid_leaves_per_month,
      paid_leaves_per_year: parsed.data.paid_leaves_per_year,
      part_time_paid_leaves_per_month: parsed.data.part_time_paid_leaves_per_month,
      part_time_paid_leaves_per_year: parsed.data.part_time_paid_leaves_per_year,
      intern_paid_leaves_per_month: parsed.data.intern_paid_leaves_per_month,
      intern_paid_leaves_per_year: parsed.data.intern_paid_leaves_per_year,
      effective_from: parsed.data.effective_from.toISOString().slice(0, 10),
    },
    ip: clientIp(req),
  });

  return ok(created);
}
