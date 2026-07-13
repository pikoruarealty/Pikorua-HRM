import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSession, hashPassword } from "@/lib/auth";
import { FINANCE_ROLES, Role, isLeadRole } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";

// Track A. GET /api/v1/employees — role-scoped list. POST — Admin/HR only,
// creates the Employee row and its linked User login in the same call
// (open decision resolved: combined, see docs/TRACK_A_TASKS.md §1.3).

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

function generateTempPassword(): string {
  return `Pk${Math.random().toString(36).slice(2, 10)}!1`;
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return failFor(ErrorCode.UNAUTHENTICATED);
  }

  const { searchParams } = new URL(req.url);
  const departmentIdFilter = searchParams.get("department_id") ?? undefined;
  const teamIdFilter = searchParams.get("team_id") ?? undefined;

  const isFinance = FINANCE_ROLES.includes(session.role);

  if (isFinance) {
    const employees = await prisma.employee.findMany({
      where: {
        ...(departmentIdFilter ? { departmentId: departmentIdFilter } : {}),
        ...(teamIdFilter ? { teamId: teamIdFilter } : {}),
      },
      select: FINANCE_SELECT,
      orderBy: { fullName: "asc" },
    });
    return ok(employees);
  }

  if (!session.employeeId) {
    return ok([]);
  }

  const viewer = await prisma.employee.findUnique({
    where: { id: session.employeeId },
    select: { teamId: true },
  });

  const isLead = isLeadRole(session.role);

  if (isLead && viewer?.teamId) {
    const employees = await prisma.employee.findMany({
      where: {
        teamId: viewer.teamId,
        ...(departmentIdFilter ? { departmentId: departmentIdFilter } : {}),
      },
      select: PUBLIC_SELECT,
      orderBy: { fullName: "asc" },
    });
    return ok(employees);
  }

  // Individual contributor (or lead with no team assigned yet): self only.
  const self = await prisma.employee.findUnique({
    where: { id: session.employeeId },
    select: PUBLIC_SELECT,
  });
  return ok(self ? [self] : []);
}

const createSchema = z.object({
  full_name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  department_id: z.string().uuid().optional(),
  team_id: z.string().uuid().optional(),
  role: z.nativeEnum(Role),
  date_of_birth: z.string().optional(),
  date_of_joining: z.string(),
  base_salary: z.number().positive(),
  device_uid: z.number().int().optional(),
  password: z.string().min(8).optional(),
});

export async function POST(req: Request) {
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

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return failFor(ErrorCode.VALIDATION, "Missing or invalid employee fields.");
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

  const existingEmail = await prisma.employee.findUnique({ where: { email: d.email } });
  if (existingEmail) {
    return fail(ErrorCode.CONFLICT, "An employee with this email already exists.", 409);
  }

  const tempPassword = d.password ?? generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  const employee = await prisma.employee.create({
    data: {
      fullName: d.full_name,
      email: d.email,
      phone: d.phone,
      departmentId: d.department_id,
      teamId: d.team_id,
      role: d.role,
      dateOfBirth: d.date_of_birth ? new Date(d.date_of_birth) : undefined,
      dateOfJoining: new Date(d.date_of_joining),
      baseSalary: d.base_salary,
      deviceUid: d.device_uid,
      user: {
        create: {
          email: d.email,
          passwordHash,
          role: d.role,
        },
      },
    },
    select: FINANCE_SELECT,
  });

  return ok(
    {
      ...employee,
      // Returned once so HR can hand it to the employee; never stored in plaintext.
      temporaryPassword: d.password ? undefined : tempPassword,
    },
    201,
  );
}
