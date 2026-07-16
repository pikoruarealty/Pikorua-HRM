import { z } from "zod";
import { Prisma, EmployeeStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, Role, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { audit, clientIp } from "@/lib/audit";
import { withPhotoPath } from "@/lib/employees/photo";

// Track A. GET/PATCH/DELETE /api/v1/employees/:id — role-scoped per PRD/API_SPEC.

const PUBLIC_SELECT = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  departmentId: true,
  teamId: true,
  role: true,
  dateOfBirth: true,
  dateOfJoining: true,
  deviceUid: true,
  photoUrl: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.EmployeeSelect;

// Salary is golden-rule data: only ever exposed to Admin/HR.
const FINANCE_SELECT = {
  ...PUBLIC_SELECT,
  baseSalary: true,
} satisfies Prisma.EmployeeSelect;

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  if (!session) {
    return failFor(ErrorCode.UNAUTHENTICATED);
  }

  const isFinance = FINANCE_ROLES.includes(session.role);
  const isLead = isLeadRole(session.role);

  if (isFinance) {
    const employee = await prisma.employee.findUnique({
      where: { id: params.id },
      select: FINANCE_SELECT,
    });
    if (!employee) return failFor(ErrorCode.NOT_FOUND, "Employee not found.");
    return ok(withPhotoPath(employee));
  }

  if (session.employeeId === params.id) {
    const self = await prisma.employee.findUnique({
      where: { id: params.id },
      select: PUBLIC_SELECT,
    });
    if (!self) return failFor(ErrorCode.NOT_FOUND, "Employee not found.");
    return ok(withPhotoPath(self));
  }

  if (isLead && session.employeeId) {
    const viewer = await prisma.employee.findUnique({
      where: { id: session.employeeId },
      select: { teamId: true },
    });
    const target = await prisma.employee.findUnique({
      where: { id: params.id },
      select: PUBLIC_SELECT,
    });
    if (target && viewer?.teamId && target.teamId === viewer.teamId) {
      return ok(withPhotoPath(target));
    }
  }

  return failFor(ErrorCode.FORBIDDEN);
}

const patchSchema = z.object({
  base_salary: z.number().positive().optional(),
  department_id: z.string().uuid().nullable().optional(),
  team_id: z.string().uuid().nullable().optional(),
  status: z.nativeEnum(EmployeeStatus).optional(),
  device_uid: z.number().int().nullable().optional(),
  // Role change is a privilege-tier change: Admin-only (narrower than the
  // Admin/HR gate on the rest of this route), and handled specially below —
  // it also updates the linked User.role and revokes their sessions.
  role: z.nativeEnum(Role).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  if (!session) {
    return failFor(ErrorCode.UNAUTHENTICATED);
  }
  if (!FINANCE_ROLES.includes(session.role)) {
    return failFor(ErrorCode.FORBIDDEN);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return failFor(
      ErrorCode.VALIDATION,
      "Only base_salary, department_id, team_id, status, device_uid, role are editable.",
    );
  }
  const d = parsed.data;

  // Role change is Admin-only and blocked on your own account (an admin
  // demoting themselves would revoke their own session mid-request).
  if (d.role !== undefined) {
    if (session.role !== Role.admin) {
      return failFor(ErrorCode.FORBIDDEN, "Only an admin can change an employee's role.");
    }
    if (session.employeeId === params.id) {
      return failFor(ErrorCode.FORBIDDEN, "You cannot change your own role.");
    }
  }

  if (d.department_id) {
    const dept = await prisma.department.findUnique({ where: { id: d.department_id } });
    if (!dept) return failFor(ErrorCode.VALIDATION, "department_id does not reference an existing department.");
  }
  if (d.team_id) {
    const team = await prisma.team.findUnique({ where: { id: d.team_id } });
    if (!team) return failFor(ErrorCode.VALIDATION, "team_id does not reference an existing team.");
  }

  const existing = await prisma.employee.findUnique({
    where: { id: params.id },
    include: { user: { select: { id: true } } },
  });
  if (!existing) {
    return failFor(ErrorCode.NOT_FOUND, "Employee not found.");
  }

  const roleChanged = d.role !== undefined && d.role !== existing.role;

  const employee = await prisma.employee.update({
    where: { id: params.id },
    data: {
      ...(d.base_salary !== undefined ? { baseSalary: d.base_salary } : {}),
      ...(d.department_id !== undefined ? { departmentId: d.department_id } : {}),
      ...(d.team_id !== undefined ? { teamId: d.team_id } : {}),
      ...(d.status !== undefined ? { status: d.status } : {}),
      ...(d.device_uid !== undefined ? { deviceUid: d.device_uid } : {}),
      ...(d.role !== undefined ? { role: d.role } : {}),
    },
    select: FINANCE_SELECT,
  });

  // Keep the authorization source (User.role, read by getSession) in sync with
  // the display role, and bump tokenVersion so the employee's existing JWTs are
  // revoked — their next request forces a re-login under the new permission tier.
  if (roleChanged && existing.user) {
    await prisma.user.update({
      where: { id: existing.user.id },
      data: { role: d.role, tokenVersion: { increment: 1 } },
    });
  }

  // Salary changes are exactly what an HR audit trail exists for — record
  // old → new alongside the other touched fields (viewer is Admin-only).
  await audit({
    action: "employee.update",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "employee",
    entityId: params.id,
    metadata: {
      changed: Object.keys(d),
      ...(d.base_salary !== undefined
        ? { base_salary_before: Number(existing.baseSalary), base_salary_after: d.base_salary }
        : {}),
      ...(d.status !== undefined ? { status_after: d.status } : {}),
      ...(roleChanged ? { role_before: existing.role, role_after: d.role } : {}),
    },
    ip: clientIp(req),
  });

  return ok(withPhotoPath(employee));
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  if (!session) {
    return failFor(ErrorCode.UNAUTHENTICATED);
  }
  if (session.role !== Role.admin) {
    return failFor(ErrorCode.FORBIDDEN);
  }

  const existing = await prisma.employee.findUnique({ where: { id: params.id } });
  if (!existing) {
    return failFor(ErrorCode.NOT_FOUND, "Employee not found.");
  }

  // Soft-delete only — status flips to inactive, row never removed.
  const employee = await prisma.employee.update({
    where: { id: params.id },
    data: { status: EmployeeStatus.inactive },
    select: FINANCE_SELECT,
  });

  // Revoke the deactivated employee's login sessions (bumps token_version so
  // any outstanding JWT is rejected on its next getSession()).
  await prisma.user.updateMany({
    where: { employeeId: params.id },
    data: { tokenVersion: { increment: 1 } },
  });

  await audit({
    action: "employee.deactivate",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "employee",
    entityId: params.id,
    ip: clientIp(_req),
  });

  return ok(withPhotoPath(employee));
}
