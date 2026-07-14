import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { AuthzError, FINANCE_ROLES, LEAD_ROLES, isFinanceRole, isLeadRole } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { WorkUnitStatus } from "@prisma/client";

// Track B. GET/POST /api/v1/work-units — Milestone 1.1 (WorkUnit CRUD, Tech only).

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().max(5000).optional(),
  departmentId: z.string().uuid(),
  teamLeadId: z.string().uuid().optional(),
  status: z.nativeEnum(WorkUnitStatus).optional(),
});

export async function POST(req: Request) {
  const session = await getSession();
  try {
    requireCreateRole(session);
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
    return failFor(ErrorCode.VALIDATION, "name and departmentId are required.");
  }
  const { name, description, status } = parsed.data;
  let { departmentId, teamLeadId } = parsed.data;

  const role = session!.role;
  const actingEmployeeId = session!.employeeId;

  if (isLeadRole(role)) {
    if (!actingEmployeeId) {
      return failFor(ErrorCode.FORBIDDEN, "Session has no linked employee record.");
    }
    const self = await prisma.employee.findUnique({ where: { id: actingEmployeeId } });
    if (!self || !self.departmentId) {
      return failFor(ErrorCode.FORBIDDEN, "Lead has no department assigned.");
    }
    if (departmentId !== self.departmentId) {
      return failFor(ErrorCode.FORBIDDEN, "Leads can only create WorkUnits in their own department.");
    }
    // Leads can only assign themselves as the team lead.
    if (teamLeadId && teamLeadId !== actingEmployeeId) {
      return failFor(ErrorCode.FORBIDDEN, "Leads can only assign themselves as team lead.");
    }
    teamLeadId = actingEmployeeId;
  } else {
    // Admin/HR: teamLeadId required, must reference a real employee.
    if (!teamLeadId) {
      return failFor(ErrorCode.VALIDATION, "teamLeadId is required.");
    }
    const lead = await prisma.employee.findUnique({ where: { id: teamLeadId } });
    if (!lead) {
      return failFor(ErrorCode.VALIDATION, "teamLeadId does not reference an existing employee.");
    }
  }

  const department = await prisma.department.findUnique({ where: { id: departmentId } });
  if (!department) {
    return failFor(ErrorCode.VALIDATION, "departmentId does not reference an existing department.");
  }

  const workUnit = await prisma.workUnit.create({
    data: {
      name,
      description,
      departmentId,
      teamLeadId: teamLeadId!,
      status: status ?? WorkUnitStatus.active,
    },
  });

  return ok(workUnit, 201);
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const { searchParams } = new URL(req.url);
  const departmentIdFilter = searchParams.get("departmentId") ?? undefined;

  const role = session.role;

  if (isFinanceRole(role)) {
    const workUnits = await prisma.workUnit.findMany({
      where: departmentIdFilter ? { departmentId: departmentIdFilter } : undefined,
      orderBy: { createdAt: "desc" },
    });
    return ok(workUnits);
  }

  if (!session.employeeId) {
    return ok([]);
  }
  const self = await prisma.employee.findUnique({ where: { id: session.employeeId } });
  if (!self || !self.departmentId) {
    return ok([]);
  }

  if (isLeadRole(role)) {
    // Leads are scoped to their own department regardless of a filter override.
    const workUnits = await prisma.workUnit.findMany({
      where: { departmentId: self.departmentId },
      orderBy: { createdAt: "desc" },
    });
    return ok(workUnits);
  }

  // Employee: own-department, status-only view (assigned WorkItems will
  // extend this scope once WorkItem CRUD lands in 1.2).
  const workUnits = await prisma.workUnit.findMany({
    where: { departmentId: self.departmentId },
    select: { id: true, name: true, status: true, departmentId: true },
    orderBy: { createdAt: "desc" },
  });
  return ok(workUnits);
}

function requireCreateRole(session: { role: import("@prisma/client").Role } | null | undefined) {
  if (!session) throw new AuthzError("UNAUTHENTICATED");
  const allowed = [...LEAD_ROLES, ...FINANCE_ROLES];
  if (!allowed.includes(session.role)) throw new AuthzError("FORBIDDEN");
}
