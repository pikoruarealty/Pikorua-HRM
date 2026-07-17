import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { ok, failFor, ErrorCode } from "@/lib/api/response";

// Track B. DELETE /api/v1/notifications/:id.
// RBAC: Any (self only). 404 (not 403) on someone else's notification, same
// convention as PATCH /notifications/:id/read.

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const notification = await prisma.notification.findUnique({ where: { id: params.id } });
  if (!notification || notification.userId !== session.userId) {
    return failFor(ErrorCode.NOT_FOUND);
  }

  await prisma.notification.delete({ where: { id: params.id } });

  return ok({ id: params.id });
}
