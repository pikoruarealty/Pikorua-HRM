import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, requireRole, AuthzError } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { audit, clientIp } from "@/lib/audit";

// Track A (2026-07-15). DELETE /api/v1/holidays/:id — Admin/HR only, audited.

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  try {
    requireRole(session, FINANCE_ROLES);
  } catch (err) {
    if (err instanceof AuthzError) return failFor(err.kind);
    throw err;
  }

  const holiday = await prisma.holiday.findUnique({ where: { id: params.id } });
  if (!holiday) return failFor(ErrorCode.NOT_FOUND);

  await prisma.holiday.delete({ where: { id: params.id } });

  await audit({
    action: "holiday.delete",
    actorUserId: session!.userId,
    actorRole: session!.role,
    entityType: "holiday",
    entityId: holiday.id,
    metadata: { date: holiday.date.toISOString().slice(0, 10), name: holiday.name },
    ip: clientIp(req),
  });

  return ok({ deleted: true });
}
