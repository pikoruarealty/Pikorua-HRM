import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { requireRole, AuthzError, Role, refreshRoleRegistry } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { audit, clientIp } from "@/lib/audit";
import { RoleTier } from "@prisma/client";

// GET /api/v1/roles — any authenticated role, for populating role dropdowns
// (employee create/edit, etc). POST — Admin-only, adds a new custom role
// (e.g. "cto") without a schema migration; see lib/rbac's refreshRoleRegistry
// for how a role's `tier` maps onto FINANCE_ROLES/LEAD_ROLES/EMPLOYEE_ROLES.

export async function GET() {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const roles = await prisma.role.findMany({ orderBy: [{ isSystem: "desc" }, { label: "asc" }] });
  return ok(roles);
}

const createSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[a-z][a-z0-9_]*$/, "key must be lowercase snake_case, e.g. cto"),
    label: z.string().min(1).max(80),
    tier: z.nativeEnum(RoleTier),
  })
  .strict();

export async function POST(req: Request) {
  const session = await getSession();
  try {
    requireRole(session, [Role.admin]);
  } catch (err) {
    if (err instanceof AuthzError) return failFor(err.kind);
    throw err;
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return failFor(ErrorCode.VALIDATION, "key (snake_case), label, and tier (finance/lead/employee) are required.");
  }
  const d = parsed.data;

  const existing = await prisma.role.findUnique({ where: { key: d.key } });
  if (existing) {
    return fail(ErrorCode.CONFLICT, `A role with key "${d.key}" already exists.`, 409);
  }

  const role = await prisma.role.create({
    data: { key: d.key, label: d.label, tier: d.tier, isSystem: false },
  });

  await refreshRoleRegistry();

  await audit({
    action: "role.create",
    actorUserId: session!.userId,
    actorRole: session!.role,
    entityType: "role",
    entityId: role.key,
    metadata: { key: d.key, label: d.label, tier: d.tier },
    ip: clientIp(req),
  });

  return ok(role, 201);
}
