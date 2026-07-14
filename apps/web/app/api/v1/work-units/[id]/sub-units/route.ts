import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";

// Track B. POST /api/v1/work-units/:id/sub-units — Milestone 1.2.

const createSchema = z.object({
  name: z.string().min(1),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const workUnit = await prisma.workUnit.findUnique({ where: { id: params.id } });
  if (!workUnit) return failFor(ErrorCode.NOT_FOUND);

  const role = session.role;
  const isOwningLead = isLeadRole(role) && session.employeeId === workUnit.teamLeadId;
  if (!isFinanceRole(role) && !isOwningLead) {
    // Don't reveal existence of WorkUnits outside the caller's scope.
    if (!isLeadRole(role)) return failFor(ErrorCode.FORBIDDEN);
    return failFor(ErrorCode.NOT_FOUND);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return failFor(ErrorCode.VALIDATION, "name is required.");
  }

  const subUnit = await prisma.subUnit.create({
    data: {
      workUnitId: workUnit.id,
      name: parsed.data.name,
    },
  });

  return ok(subUnit, 201);
}
