import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { requireRole, isLeadRole, AuthzError, Role, FINANCE_ROLES } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { HHMM_REGEX } from "@/lib/attendance/time";

// Track A. GET /api/v1/teams — Admin/HR see all, Lead/Employee scoped to own
// department (server-side). POST — Admin/HR only.
const createSchema = z.object({
  department_id: z.string().uuid(),
  name: z.string().min(1),
  team_lead_id: z.string().uuid(),
  // "HH:MM" 24h — used by attendance summary to compute the team's late count.
  expected_start_time: z.string().regex(HHMM_REGEX).nullable().optional(),
});

export async function GET() {
  const session = await getSession();
  if (!session) {
    return failFor(ErrorCode.UNAUTHENTICATED);
  }

  let departmentId: string | undefined;
  if (!FINANCE_ROLES.includes(session.role)) {
    if (!session.employeeId) {
      return ok([]);
    }
    const employee = await prisma.employee.findUnique({
      where: { id: session.employeeId },
      select: { departmentId: true },
    });
    if (!employee?.departmentId) {
      return ok([]);
    }
    departmentId = employee.departmentId;
  }

  const teams = await prisma.team.findMany({
    where: departmentId ? { departmentId } : undefined,
    include: {
      department: { select: { id: true, name: true, typeKey: true } },
      teamLead: { select: { id: true, fullName: true } },
    },
    orderBy: { name: "asc" },
  });

  return ok(teams);
}

export async function POST(req: Request) {
  const session = await getSession();
  try {
    requireRole(session, FINANCE_ROLES);
  } catch (err) {
    if (err instanceof AuthzError) return failFor(err.kind);
    throw err;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return failFor(
      ErrorCode.VALIDATION,
      "department_id, name, and team_lead_id are required.",
    );
  }

  const { department_id, name, team_lead_id, expected_start_time } = parsed.data;

  const department = await prisma.department.findUnique({ where: { id: department_id } });
  if (!department) {
    return failFor(ErrorCode.VALIDATION, "department_id does not reference an existing department.");
  }

  const lead = await prisma.employee.findUnique({ where: { id: team_lead_id } });
  if (!lead) {
    return failFor(ErrorCode.VALIDATION, "team_lead_id does not reference an existing employee.");
  }
  if (!isLeadRole(lead.role)) {
    return fail(
      ErrorCode.VALIDATION,
      "team_lead_id must reference an employee with a lead role.",
      422,
    );
  }

  const team = await prisma.team.create({
    data: {
      departmentId: department_id,
      name,
      teamLeadId: team_lead_id,
      expectedStartTime: expected_start_time ?? null,
    },
    include: {
      department: { select: { id: true, name: true, typeKey: true } },
      teamLead: { select: { id: true, fullName: true } },
    },
  });

  return ok(team, 201);
}
