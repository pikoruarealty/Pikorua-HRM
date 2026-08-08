import { prisma } from "@/lib/db/prisma";
import { isFinanceRole, isLeadRole } from "@/lib/rbac";
import type { AppSession } from "@/lib/auth/session";

// Who may write and who may read a monthly performance review (Pillar 3,
// 2026-08-08). Shared by the create/list route and the update route so the
// three can't drift apart.
//
// Read access deliberately matches employees/:id/task-activity — self, the
// Lead who owns the employee's team, or Admin/HR. Write access is the same set
// minus "self": nobody rates their own month, including Admin.

export type ReviewAccess = {
  employee: { id: string; fullName: string; dateOfJoining: Date; teamLeadId: string | null };
  canRead: boolean;
  /** May create/update a review of this employee. */
  canWrite: boolean;
  isSelf: boolean;
};

/** Resolves the caller's authority over one employee's reviews. Returns null
 *  when the employee doesn't exist (caller maps that to NOT_FOUND). */
export async function getReviewAccess(
  session: AppSession,
  employeeId: string,
): Promise<ReviewAccess | null> {
  const row = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      fullName: true,
      dateOfJoining: true,
      team: { select: { teamLeadId: true } },
    },
  });
  if (!row) return null;

  const employee = {
    id: row.id,
    fullName: row.fullName,
    dateOfJoining: row.dateOfJoining,
    teamLeadId: row.team?.teamLeadId ?? null,
  };

  const isSelf = session.employeeId === employee.id;
  const isOwningLead =
    isLeadRole(session.role) &&
    session.employeeId != null &&
    session.employeeId === employee.teamLeadId;
  const canWrite = !isSelf && (isFinanceRole(session.role) || isOwningLead);

  return { employee, canRead: canWrite || isSelf, canWrite, isSelf };
}

/** The employees this caller may review: Admin/HR see everyone active, a Lead
 *  sees their own team members. Self is always excluded — see above. */
export async function getReviewableEmployees(session: AppSession) {
  if (!isFinanceRole(session.role) && !isLeadRole(session.role)) return [];

  const teamFilter = isFinanceRole(session.role)
    ? {}
    : { team: { teamLeadId: session.employeeId ?? "" } };

  return prisma.employee.findMany({
    where: {
      status: "active",
      ...(session.employeeId ? { id: { not: session.employeeId } } : {}),
      ...teamFilter,
    },
    select: {
      id: true,
      fullName: true,
      photoUrl: true,
      dateOfJoining: true,
      role: true,
      team: { select: { id: true, name: true } },
    },
    orderBy: { fullName: "asc" },
  });
}
