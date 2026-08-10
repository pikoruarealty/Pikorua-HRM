import { prisma } from "@/lib/db/prisma";

// Shared "teams this Lead leads (any number of them) + self" scoping query.
// Previously duplicated inline in daily-selections/today/route.ts and
// work-units/[id]/assignable-members/route.ts (the "reassign only shows the
// same employee" bug fix, Phase 16) — factored out here for the new
// team-wide task-progress route so it isn't duplicated a third time.
export async function getLedEmployeeIds(leadEmployeeId: string): Promise<string[]> {
  const teams = await prisma.team.findMany({
    where: { teamLeadId: leadEmployeeId },
    select: { members: { select: { id: true } } },
  });
  const employeeIds = teams.flatMap((t) => t.members.map((m) => m.id));
  if (!employeeIds.includes(leadEmployeeId)) {
    employeeIds.push(leadEmployeeId);
  }
  return employeeIds;
}

/**
 * Does `leadEmployeeId` lead `employeeId` (or is it themselves)?
 *
 * The single-employee form of getLedEmployeeIds, for the many per-employee
 * detail routes that only need a yes/no. Kept here so every "can this Lead see
 * this person?" decision in the codebase resolves the same way — routes used to
 * hand-roll this two different ways, and the `viewer.teamId === target.teamId`
 * variant silently hid a Lead's second team from them.
 */
export async function leadsEmployee(
  leadEmployeeId: string,
  employeeId: string,
): Promise<boolean> {
  if (leadEmployeeId === employeeId) return true;
  const team = await prisma.team.findFirst({
    where: { teamLeadId: leadEmployeeId, members: { some: { id: employeeId } } },
    select: { id: true },
  });
  return team !== null;
}
