import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { EmployeeStatus } from "@prisma/client";

// Track B. GET /api/v1/events/today — Milestone 3.5.
// RBAC: Any. Derived, not persisted (PRD §5.11 / SCHEMA.md `events` note) —
// computed on read by comparing month/day of `date_of_birth` /
// `date_of_joining` against today, for the login banner.

export async function GET() {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const now = new Date();
  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();

  const employees = await prisma.employee.findMany({
    where: { status: EmployeeStatus.active },
    select: { id: true, fullName: true, dateOfBirth: true, dateOfJoining: true },
  });

  const birthdays = employees.filter(
    (e) => e.dateOfBirth && e.dateOfBirth.getUTCMonth() + 1 === month && e.dateOfBirth.getUTCDate() === day,
  );
  const anniversaries = employees.filter(
    (e) => e.dateOfJoining.getUTCMonth() + 1 === month && e.dateOfJoining.getUTCDate() === day,
  );

  return ok({
    birthdays: birthdays.map((e) => ({ employeeId: e.id, fullName: e.fullName })),
    anniversaries: anniversaries.map((e) => ({ employeeId: e.id, fullName: e.fullName })),
  });
}
