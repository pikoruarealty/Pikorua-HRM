import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { WorkItemMode } from "@prisma/client";

// Track B. POST /api/v1/sub-units/:id/work-items — Milestone 1.2 (atomic mode only).

const createSchema = z.object({
  title: z.string().min(1),
  assignedTo: z.string().uuid(),
  mode: z.nativeEnum(WorkItemMode),
  taskPoints: z.number().int().positive().optional(),
  targetValue: z.number().positive().optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const subUnit = await prisma.subUnit.findUnique({
    where: { id: params.id },
    include: { workUnit: true },
  });
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
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return failFor(ErrorCode.VALIDATION, "title, assignedTo, and mode are required.");
  }
  const { title, assignedTo, mode, taskPoints } = parsed.data;

  if (mode === WorkItemMode.metric) {
    return failFor(ErrorCode.NOT_IMPLEMENTED, "Metric-mode WorkItems are not supported until Milestone 2.");
  }
  if (taskPoints === undefined) {
    return failFor(ErrorCode.VALIDATION, "taskPoints is required for atomic-mode WorkItems.");
  }

  const assignee = await prisma.employee.findUnique({ where: { id: assignedTo } });
  if (!assignee) {
    return failFor(ErrorCode.VALIDATION, "assignedTo does not reference an existing employee.");
  }

  const workItem = await prisma.workItem.create({
    data: {
      subUnitId: subUnit.id,
      assignedTo,
      title,
      mode: WorkItemMode.atomic,
      taskPoints,
    },
  });

  return ok(workItem, 201);
}
