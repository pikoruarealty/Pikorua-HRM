import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { Role } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { audit, clientIp } from "@/lib/audit";

// Admin manual override (2026-07-15). DELETE /api/v1/announcements/:id —
// **Admin only**: remove a stale or mistaken announcement (creators cannot
// delete their own in v1 — announcements are broadcast history; the admin
// escape hatch is deliberate and audited).

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (session.role !== Role.admin) return failFor(ErrorCode.FORBIDDEN);

  const announcement = await prisma.announcement.findUnique({ where: { id: params.id } });
  if (!announcement) return failFor(ErrorCode.NOT_FOUND);

  await prisma.announcement.delete({ where: { id: params.id } });

  await audit({
    action: "announcement.delete",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "announcement",
    entityId: params.id,
    metadata: { title: announcement.title, scope_type: announcement.scopeType },
    ip: clientIp(req),
  });

  return ok({ deleted: true });
}
