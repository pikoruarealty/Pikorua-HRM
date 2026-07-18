import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";

// Track B. GET/PATCH/DELETE /api/v1/sub-units/:id.
// RBAC mirrors POST /work-units/:id/sub-units — Admin/HR, or the owning Lead
// (resolved via the parent WorkUnit's teamLeadId).

async function loadManageable(id: string) {
  const subUnit = await prisma.subUnit.findUnique({
    where: { id },
    include: { workUnit: true },
  });
  if (!subUnit || subUnit.deletedAt || subUnit.workUnit.deletedAt) return null;
  return subUnit;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const subUnit = await loadManageable(params.id);
  if (!subUnit) return failFor(ErrorCode.NOT_FOUND);

  return ok(subUnit);
}

const patchSchema = z.object({
  name: z.string().min(1),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const subUnit = await loadManageable(params.id);
  if (!subUnit) return failFor(ErrorCode.NOT_FOUND);

  const role = session.role;
  const isOwningLead = isLeadRole(role) && session.employeeId === subUnit.workUnit.teamLeadId;
  if (!isFinanceRole(role) && !isOwningLead) {
    if (!isLeadRole(role)) return failFor(ErrorCode.FORBIDDEN);
    return failFor(ErrorCode.NOT_FOUND);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return failFor(ErrorCode.VALIDATION, "name is required.");
  }

  const updated = await prisma.subUnit.update({
    where: { id: params.id },
    data: { name: parsed.data.name },
  });

  return ok(updated);
}

// DELETE — soft delete, cascading to its non-deleted WorkItems (one transaction).
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const subUnit = await loadManageable(params.id);
  if (!subUnit) return failFor(ErrorCode.NOT_FOUND);

  const role = session.role;
  const isOwningLead = isLeadRole(role) && session.employeeId === subUnit.workUnit.teamLeadId;
  if (!isFinanceRole(role) && !isOwningLead) {
    if (!isLeadRole(role)) return failFor(ErrorCode.FORBIDDEN);
    return failFor(ErrorCode.NOT_FOUND);
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.workItem.updateMany({
      where: { subUnitId: params.id, deletedAt: null },
      data: { deletedAt: now },
    }),
    prisma.subUnit.update({ where: { id: params.id }, data: { deletedAt: now } }),
  ]);

  return ok({ id: params.id, deleted: true });
}
