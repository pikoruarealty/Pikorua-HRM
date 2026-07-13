import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { ok, failFor, ErrorCode } from "@/lib/api/response";

// SHARED (Phase 0). GET /api/v1/auth/me — current user + role + employee summary.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return failFor(ErrorCode.UNAUTHENTICATED);
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: {
      employee: {
        select: {
          id: true,
          fullName: true,
          departmentId: true,
          teamId: true,
          role: true,
        },
      },
    },
  });

  if (!user) {
    // Session references a user that no longer exists.
    return failFor(ErrorCode.UNAUTHENTICATED, "Session is no longer valid.");
  }

  return ok({
    id: user.id,
    email: user.email,
    role: user.role,
    employee: user.employee,
  });
}
