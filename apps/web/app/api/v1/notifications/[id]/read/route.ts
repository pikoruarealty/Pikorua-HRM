import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { ok, failFor, ErrorCode } from "@/lib/api/response";

// Track B. PATCH /api/v1/notifications/:id/read — Milestone 3.2.
// RBAC: Any (self only). 404 (not 403) on someone else's notification, to
// avoid leaking existence — same convention as requests/:id.

export async function PATCH(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const notification = await prisma.notification.findUnique({ where: { id: params.id } });
  if (!notification || notification.userId !== session.userId) {
    return failFor(ErrorCode.NOT_FOUND);
  }

  const updated = await prisma.notification.update({
    where: { id: params.id },
    data: { readAt: notification.readAt ?? new Date() },
  });

  return ok(updated);
}
