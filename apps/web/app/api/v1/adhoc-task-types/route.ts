import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { isFinanceRole } from "@/lib/rbac";

// GET /api/v1/adhoc-task-types (2026-08-10) — the fixed catalog an employee
// picks from when logging their own task. Readable by any authenticated user:
// it is the menu on the self-log form, and its points are policy an Admin set,
// not anyone's private data.
//
// Inactive types stay in the table (older WorkItems still point at them) but
// are hidden here, so a retired type can't be chosen again. Admin/HR can ask
// for the full list with ?includeInactive=1 to manage it.

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const includeInactive =
    new URL(req.url).searchParams.get("includeInactive") === "1" && isFinanceRole(session.role);

  const types = await prisma.adhocTaskType.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    select: { id: true, key: true, label: true, points: true, active: true, sortOrder: true },
  });
  return ok(types);
}
