import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isEmployeeRole, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";

// Track B. GET /api/v1/daily-selections/today — Milestone 2.3.
// Employee, Lead (own team) only per API_SPEC §5 — Admin/HR are deliberately
// excluded here, matching the strict-role convention set in 1.2/1.3.

function todayUtcDate(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const date = todayUtcDate();
  const { searchParams } = new URL(req.url);
  const employeeIdFilter = searchParams.get("employee_id") ?? undefined;

  if (isLeadRole(session.role)) {
    if (!session.employeeId) return ok([]);
    const teams = await prisma.team.findMany({
      where: { teamLeadId: session.employeeId },
      select: { members: { select: { id: true } } },
    });
    const scopedEmployeeIds = teams.flatMap((t) => t.members.map((m) => m.id));
    // The Lead's own Employee record may not be a `TeamMembers` row on the
    // team they lead — but they can be a WorkItem assignee just like anyone
    // else, so always include themselves in scope.
    if (!scopedEmployeeIds.includes(session.employeeId)) {
      scopedEmployeeIds.push(session.employeeId);
    }

    if (employeeIdFilter && !scopedEmployeeIds.includes(employeeIdFilter)) {
      return failFor(ErrorCode.FORBIDDEN, "That employee is not on your team.");
    }

    const selections = await prisma.dailyTaskSelection.findMany({
      where: {
        date,
        employeeId: employeeIdFilter ? employeeIdFilter : { in: scopedEmployeeIds },
      },
      include: { workItem: true, employee: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: "asc" },
    });
    return ok(selections);
  }

  if (isEmployeeRole(session.role)) {
    if (!session.employeeId) return ok([]);
    const selections = await prisma.dailyTaskSelection.findMany({
      where: { employeeId: session.employeeId, date },
      include: { workItem: true },
      orderBy: { createdAt: "asc" },
    });
    return ok(selections);
  }

  return failFor(ErrorCode.FORBIDDEN);
}
