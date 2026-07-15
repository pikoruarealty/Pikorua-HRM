import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { Role } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";

// GET /api/v1/audit-logs — Admin ONLY (tighter than FINANCE_ROLES: HR's own
// actions are themselves audited, so the trail's reader is the narrowest
// role we have — matches PUT /payroll/config being Admin-only). Paginated,
// filterable by action/actor/entity/date. Production hardening, 2026-07-15.
const querySchema = z.object({
  action: z.string().optional(),
  actor_user_id: z.string().uuid().optional(),
  entity_type: z.string().optional(),
  entity_id: z.string().uuid().optional(),
  date_from: z.coerce.date().optional(),
  date_to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return failFor(ErrorCode.UNAUTHENTICATED);
  }
  if (session.role !== Role.admin) {
    return failFor(ErrorCode.FORBIDDEN, "Only Admin can view the audit log.");
  }

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return failFor(ErrorCode.VALIDATION, "Invalid audit log filters.");
  }
  const q = parsed.data;

  const where = {
    ...(q.action ? { action: { startsWith: q.action } } : {}),
    ...(q.actor_user_id ? { actorUserId: q.actor_user_id } : {}),
    ...(q.entity_type ? { entityType: q.entity_type } : {}),
    ...(q.entity_id ? { entityId: q.entity_id } : {}),
    ...(q.date_from || q.date_to
      ? {
          createdAt: {
            ...(q.date_from ? { gte: q.date_from } : {}),
            ...(q.date_to ? { lte: q.date_to } : {}),
          },
        }
      : {}),
  };

  const [total, logs] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      include: { actor: { select: { email: true, role: true } } },
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
  ]);

  return ok({
    logs,
    pagination: {
      page: q.page,
      limit: q.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / q.limit)),
    },
  });
}
