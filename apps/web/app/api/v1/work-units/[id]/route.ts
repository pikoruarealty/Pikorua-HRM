import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { WorkUnitStatus } from "@prisma/client";

// Track B. GET/PATCH /api/v1/work-units/:id — Milestone 1.1.

const nestedInclude = {
  subUnits: { include: { workItems: true } },
} as const;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const workUnit = await prisma.workUnit.findUnique({
    where: { id: params.id },
    include: nestedInclude,
  });
  if (!workUnit) return failFor(ErrorCode.NOT_FOUND);

  const role = session.role;
  if (isFinanceRole(role)) {
    return ok(workUnit);
  }

  if (!session.employeeId) return failFor(ErrorCode.NOT_FOUND);
  const self = await prisma.employee.findUnique({ where: { id: session.employeeId } });
  if (!self || self.departmentId !== workUnit.departmentId) {
    // Don't reveal existence of WorkUnits outside the caller's scope.
    return failFor(ErrorCode.NOT_FOUND);
  }

  if (isLeadRole(role)) {
    return ok(workUnit);
  }

  // Employee: status-only view of their own department's WorkUnits, but
  // still nested so an assigned Employee can see their own WorkItems.
  return ok({
    id: workUnit.id,
    name: workUnit.name,
    status: workUnit.status,
    departmentId: workUnit.departmentId,
    subUnits: workUnit.subUnits.map((su) => ({
      id: su.id,
      name: su.name,
      workItems: su.workItems.filter((wi) => wi.assignedTo === session.employeeId),
    })),
  });
}

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.nativeEnum(WorkUnitStatus).optional(),
  teamLeadId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const workUnit = await prisma.workUnit.findUnique({ where: { id: params.id } });
  if (!workUnit) return failFor(ErrorCode.NOT_FOUND);

  const role = session.role;
  const isOwningLead =
    isLeadRole(role) && session.employeeId === workUnit.teamLeadId;
  if (!isFinanceRole(role) && !isOwningLead) {
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
    return failFor(ErrorCode.VALIDATION, "Invalid request body.");
  }
  const { name, status, teamLeadId, departmentId } = parsed.data;

  // Owning Leads can only update name/status; reassignment is Admin/HR-only.
  if (isOwningLead && !isFinanceRole(role) && (teamLeadId || departmentId)) {
    return failFor(ErrorCode.FORBIDDEN, "Only Admin/HR can reassign a WorkUnit's lead or department.");
  }

  if (teamLeadId) {
    const lead = await prisma.employee.findUnique({ where: { id: teamLeadId } });
    if (!lead) return failFor(ErrorCode.VALIDATION, "teamLeadId does not reference an existing employee.");
  }
  if (departmentId) {
    const department = await prisma.department.findUnique({ where: { id: departmentId } });
    if (!department) return failFor(ErrorCode.VALIDATION, "departmentId does not reference an existing department.");
  }

  const updated = await prisma.workUnit.update({
    where: { id: params.id },
    data: { name, status, teamLeadId, departmentId },
  });

  return ok(updated);
}
