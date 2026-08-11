import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, isLeadRole } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { isUuid } from "@/lib/api/params";
import { leadsEmployee } from "@/lib/employees/managed-scope";
import { audit, clientIp } from "@/lib/audit";

// PATCH /api/v1/employees/:id/sales-targets — per-employee overrides on top
// of the org-wide SalesTargetConfig (lib/sales/targets.ts: resolveTargets —
// override wins where set, null falls back to the org default). Deliberately
// a separate route from PATCH /employees/:id: these three fields are not
// golden-rule data (not salary/role), and the Lead who runs the team is who
// should be able to say a senior rep carries 150 calls/day while a new
// joiner carries 60 — the main employee-edit route stays Admin/HR-only.
const patchSchema = z
  .object({
    daily_call_target: z.number().int().min(1).nullable().optional(),
    monthly_site_visit_target: z.number().int().min(0).nullable().optional(),
    monthly_booking_target: z.number().int().min(0).nullable().optional(),
  })
  .strict();

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!isUuid(params.id)) return failFor(ErrorCode.NOT_FOUND);

  const isFinance = FINANCE_ROLES.includes(session.role);
  const isLead = isLeadRole(session.role) && !!session.employeeId;
  if (!isFinance && !(isLead && (await leadsEmployee(session.employeeId!, params.id)))) {
    return failFor(ErrorCode.FORBIDDEN);
  }

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return fail(ErrorCode.VALIDATION, "Invalid sales target payload.", 422);
  }
  const d = parsed.data;

  const existing = await prisma.employee.findUnique({
    where: { id: params.id },
    select: { id: true, departmentId: true, department: { select: { typeKey: true } } },
  });
  if (!existing) return failFor(ErrorCode.NOT_FOUND, "Employee not found.");
  if (!existing.department || existing.department.typeKey === "tech") {
    return failFor(ErrorCode.VALIDATION, "Sales targets only apply to metric (sales/BD) departments.");
  }

  const updated = await prisma.employee.update({
    where: { id: params.id },
    data: {
      ...(d.daily_call_target !== undefined ? { dailyCallTarget: d.daily_call_target } : {}),
      ...(d.monthly_site_visit_target !== undefined
        ? { monthlySiteVisitTarget: d.monthly_site_visit_target }
        : {}),
      ...(d.monthly_booking_target !== undefined
        ? { monthlyBookingTarget: d.monthly_booking_target }
        : {}),
    },
    select: {
      id: true,
      dailyCallTarget: true,
      monthlySiteVisitTarget: true,
      monthlyBookingTarget: true,
    },
  });

  await audit({
    action: "employee.sales_targets_update",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "employee",
    entityId: params.id,
    metadata: { changed: Object.keys(d), ...d },
    ip: clientIp(req),
  });

  return ok(updated);
}
