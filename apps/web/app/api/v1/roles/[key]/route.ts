import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { requireRole, AuthzError, Role, refreshRoleRegistry } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { audit, clientIp } from "@/lib/audit";
import { RoleTier } from "@prisma/client";

// PATCH/DELETE /api/v1/roles/:key — Admin-only. System roles (the original 7)
// can't be renamed-by-key or deleted — a few code paths (golden-rule gates,
// self-role-change guard) still refer to `admin`/`hr` by literal key — but
// their label/tier can still be edited like a custom role's.

const patchSchema = z
  .object({
    label: z.string().min(1).max(80).optional(),
    tier: z.nativeEnum(RoleTier).optional(),
  })
  .strict();

export async function PATCH(req: Request, { params }: { params: { key: string } }) {
  const session = await getSession();
  try {
    requireRole(session, [Role.admin]);
  } catch (err) {
    if (err instanceof AuthzError) return failFor(err.kind);
    throw err;
  }

  const existing = await prisma.role.findUnique({ where: { key: params.key } });
  if (!existing) return failFor(ErrorCode.NOT_FOUND, "Role not found.");

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return failFor(ErrorCode.VALIDATION, "Invalid request body.");
  }
  const d = parsed.data;
  if (Object.keys(d).length === 0) {
    return failFor(ErrorCode.VALIDATION, "No fields to update.");
  }

  const role = await prisma.role.update({
    where: { key: params.key },
    data: {
      ...(d.label !== undefined ? { label: d.label } : {}),
      ...(d.tier !== undefined ? { tier: d.tier } : {}),
    },
  });

  await refreshRoleRegistry();

  await audit({
    action: "role.update",
    actorUserId: session!.userId,
    actorRole: session!.role,
    entityType: "role",
    entityId: role.key,
    metadata: { changed: Object.keys(d), ...d },
    ip: clientIp(req),
  });

  return ok(role);
}

export async function DELETE(req: Request, { params }: { params: { key: string } }) {
  const session = await getSession();
  try {
    requireRole(session, [Role.admin]);
  } catch (err) {
    if (err instanceof AuthzError) return failFor(err.kind);
    throw err;
  }

  const existing = await prisma.role.findUnique({ where: { key: params.key } });
  if (!existing) return failFor(ErrorCode.NOT_FOUND, "Role not found.");
  if (existing.isSystem) {
    return failFor(ErrorCode.FORBIDDEN, "System roles cannot be deleted.");
  }

  const [employeeCount, userCount] = await Promise.all([
    prisma.employee.count({ where: { role: params.key } }),
    prisma.user.count({ where: { role: params.key } }),
  ]);
  if (employeeCount > 0 || userCount > 0) {
    return fail(
      ErrorCode.CONFLICT,
      `"${params.key}" is still assigned to ${Math.max(employeeCount, userCount)} account(s) — reassign them before deleting this role.`,
      409,
    );
  }

  await prisma.role.delete({ where: { key: params.key } });
  await refreshRoleRegistry();

  await audit({
    action: "role.delete",
    actorUserId: session!.userId,
    actorRole: session!.role,
    entityType: "role",
    entityId: params.key,
    ip: clientIp(req),
  });

  return ok({ deleted: true });
}
