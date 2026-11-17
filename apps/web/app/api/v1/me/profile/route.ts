import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { audit, clientIp } from "@/lib/audit";
import { withPhotoPath } from "@/lib/employees/photo";
import { validateSelfProfile } from "@/lib/employees/self-profile";
import { todayDateOnly } from "@/lib/attendance/time";

// GET/PATCH /api/v1/me/profile — an employee viewing/editing their OWN basic
// details (2026-11-17): name, phone, date of birth. The target is always the
// session's employee, never a body/path id, so there is no way to point this
// at someone else. Email, role, salary, department, joining date, WFH switch
// and the rest remain Admin/HR via PATCH /employees/:id. The photo is changed
// through POST /employees/:id/photo (which now also admits the owner).
// Nothing here is golden-rule data (no salary/incentive/leave approval).

const SELF_SELECT = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  dateOfBirth: true,
  photoUrl: true,
} as const;

export async function GET() {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!session.employeeId) return failFor(ErrorCode.NOT_FOUND, "This account has no employee profile.");

  const me = await prisma.employee.findUnique({ where: { id: session.employeeId }, select: SELF_SELECT });
  if (!me) return failFor(ErrorCode.NOT_FOUND, "Employee not found.");
  return ok(withPhotoPath(me));
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!session.employeeId) return failFor(ErrorCode.NOT_FOUND, "This account has no employee profile.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
  }

  const today = todayDateOnly().toISOString().slice(0, 10);
  const result = validateSelfProfile(body, today);
  if (!result.ok) return failFor(ErrorCode.VALIDATION, result.message);
  const d = result.data;

  const existing = await prisma.employee.findUnique({ where: { id: session.employeeId }, select: SELF_SELECT });
  if (!existing) return failFor(ErrorCode.NOT_FOUND, "Employee not found.");

  const updated = await prisma.employee.update({
    where: { id: existing.id },
    data: {
      ...(d.full_name !== undefined ? { fullName: d.full_name } : {}),
      ...(d.phone !== undefined ? { phone: d.phone } : {}),
      ...(d.date_of_birth !== undefined
        ? { dateOfBirth: d.date_of_birth ? new Date(d.date_of_birth) : null }
        : {}),
    },
    select: SELF_SELECT,
  });

  const before = (v: Date | null) => (v ? v.toISOString().slice(0, 10) : null);
  await audit({
    action: "employee.self_update",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "employee",
    entityId: existing.id,
    metadata: {
      changed: Object.keys(d),
      ...(d.full_name !== undefined ? { full_name_before: existing.fullName, full_name_after: d.full_name } : {}),
      ...(d.phone !== undefined ? { phone_before: existing.phone, phone_after: d.phone } : {}),
      ...(d.date_of_birth !== undefined
        ? { date_of_birth_before: before(existing.dateOfBirth), date_of_birth_after: d.date_of_birth }
        : {}),
    },
    ip: clientIp(req),
  });

  return ok(withPhotoPath(updated));
}
