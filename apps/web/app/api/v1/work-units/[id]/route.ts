import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { WorkUnitStatus } from "@prisma/client";

// Track B. GET/PATCH/DELETE /api/v1/work-units/:id — Milestone 1.1.

const nestedInclude = {
  subUnits: {
    where: { deletedAt: null },
    include: {
      workItems: {
        where: { deletedAt: null },
        include: { assignee: { select: { id: true, fullName: true } } },
      },
    },
  },
} as const;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const workUnit = await prisma.workUnit.findUnique({
    where: { id: params.id },
    include: nestedInclude,
  });
  if (!workUnit || workUnit.deletedAt) return failFor(ErrorCode.NOT_FOUND);

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
  description: z.string().max(5000).nullable().optional(),
  status: z.nativeEnum(WorkUnitStatus).optional(),
  projectLeadId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const workUnit = await prisma.workUnit.findUnique({ where: { id: params.id } });
  if (!workUnit || workUnit.deletedAt) return failFor(ErrorCode.NOT_FOUND);

  const role = session.role;
  // Project lead can be any employee now (2026-08-07, was Lead-role-only) —
  // ownership is purely "am I the assigned projectLeadId", not a role check.
  const isProjectLead = session.employeeId === workUnit.projectLeadId;
  if (!isFinanceRole(role) && !isProjectLead) {
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
  const { name, description, status, projectLeadId, departmentId } = parsed.data;

  // Project leads can only update name/status; reassignment is Admin/HR-only.
  if (isProjectLead && !isFinanceRole(role) && (projectLeadId || departmentId)) {
    return failFor(ErrorCode.FORBIDDEN, "Only Admin/HR can reassign a WorkUnit's project lead or department.");
  }

  if (projectLeadId) {
    const lead = await prisma.employee.findUnique({ where: { id: projectLeadId } });
    if (!lead) return failFor(ErrorCode.VALIDATION, "projectLeadId does not reference an existing employee.");
  }
  if (departmentId) {
    const department = await prisma.department.findUnique({ where: { id: departmentId } });
    if (!department) return failFor(ErrorCode.VALIDATION, "departmentId does not reference an existing department.");
  }

  const updated = await prisma.workUnit.update({
    where: { id: params.id },
    data: { name, description, status, projectLeadId, departmentId },
  });

  return ok(updated);
}

// DELETE /api/v1/work-units/:id — soft delete, cascading to its non-deleted
// SubUnits and their WorkItems (one transaction). Same RBAC as PATCH.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const workUnit = await prisma.workUnit.findUnique({ where: { id: params.id } });
  if (!workUnit || workUnit.deletedAt) return failFor(ErrorCode.NOT_FOUND);

  const role = session.role;
  const isProjectLead = session.employeeId === workUnit.projectLeadId;
  if (!isFinanceRole(role) && !isProjectLead) {
    return failFor(ErrorCode.FORBIDDEN);
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.workItem.updateMany({
      where: { subUnit: { workUnitId: params.id }, deletedAt: null },
      data: { deletedAt: now },
    }),
    prisma.subUnit.updateMany({
      where: { workUnitId: params.id, deletedAt: null },
      data: { deletedAt: now },
    }),
    prisma.workUnit.update({ where: { id: params.id }, data: { deletedAt: now } }),
  ]);

  return ok({ id: params.id, deleted: true });
}
