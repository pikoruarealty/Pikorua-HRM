import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { requireRole, FINANCE_ROLES, AuthzError } from "@/lib/rbac";
import { ok, failFor } from "@/lib/api/response";

// Track A (owner request, 2026-08-08). GET /api/v1/attendance/weekly-off/all
// Admin/HR only. Returns all currently *active* WeeklyOffMove records across
// all employees, ordered by weekStart desc then employee name — used by the
// "Weekly off claims" card in the attendance screen so Admin/HR can see every
// active self-declared off day at a glance and revert any of them.

export async function GET(req: Request) {
  const session = await getSession();
  try {
    requireRole(session, FINANCE_ROLES);
  } catch (err) {
    if (err instanceof AuthzError) return failFor(err.kind);
    throw err;
  }

  const moves = await prisma.weeklyOffMove.findMany({
    where: { active: true },
    include: {
      employee: { select: { id: true, fullName: true } },
    },
    orderBy: [{ weekStart: "desc" }, { employee: { fullName: "asc" } }],
  });

  return ok(
    moves.map((m) => ({
      id: m.id,
      employee: m.employee,
      weekStart: m.weekStart.toISOString().slice(0, 10),
      date: m.date.toISOString().slice(0, 10),
      createdAt: m.createdAt.toISOString(),
    })),
  );
}
