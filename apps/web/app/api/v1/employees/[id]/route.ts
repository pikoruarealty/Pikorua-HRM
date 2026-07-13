import { z } from "zod";
import { Prisma, EmployeeStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, Role, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";

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
    return ok(employee);
  }

  if (session.employeeId === params.id) {
    const self = await prisma.employee.findUnique({
      where: { id: params.id },
      select: PUBLIC_SELECT,
    });
    if (!self) return failFor(ErrorCode.NOT_FOUND, "Employee not found.");
    return ok(self);
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
      return ok(target);
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
      "Only base_salary, department_id, team_id, status, device_uid are editable.",
    );
  }
  const d = parsed.data;

  if (d.department_id) {
    const dept = await prisma.department.findUnique({ where: { id: d.department_id } });
    if (!dept) return failFor(ErrorCode.VALIDATION, "department_id does not reference an existing department.");
  }
  if (d.team_id) {
    const team = await prisma.team.findUnique({ where: { id: d.team_id } });
    if (!team) return failFor(ErrorCode.VALIDATION, "team_id does not reference an existing team.");
  }

  const existing = await prisma.employee.findUnique({ where: { id: params.id } });
  if (!existing) {
    return failFor(ErrorCode.NOT_FOUND, "Employee not found.");
  }

  const employee = await prisma.employee.update({
    where: { id: params.id },
    data: {
      ...(d.base_salary !== undefined ? { baseSalary: d.base_salary } : {}),
      ...(d.department_id !== undefined ? { departmentId: d.department_id } : {}),
      ...(d.team_id !== undefined ? { teamId: d.team_id } : {}),
      ...(d.status !== undefined ? { status: d.status } : {}),
      ...(d.device_uid !== undefined ? { deviceUid: d.device_uid } : {}),
    },
    select: FINANCE_SELECT,
  });

  return ok(employee);
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

  return ok(employee);
}
