import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { WorkItemMode } from "@prisma/client";

// Track B. POST /api/v1/sub-units/:id/work-items — Milestone 1.2 (atomic) + 2.2 (metric).

const currentYear = new Date().getFullYear();

const createSchema = z.object({
  title: z.string().min(1),
  assignedTo: z.string().uuid(),
  mode: z.nativeEnum(WorkItemMode),
  taskPoints: z.number().int().positive().optional(),
  targetValue: z.number().positive().optional(),
  periodMonth: z.number().int().min(1).max(12).optional(),
  periodYear: z.number().int().min(currentYear - 1).max(currentYear + 1).optional(),
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
  const { title, assignedTo, mode, taskPoints, targetValue, periodMonth, periodYear } = parsed.data;

  const assignee = await prisma.employee.findUnique({ where: { id: assignedTo } });
  if (!assignee) {
    return failFor(ErrorCode.VALIDATION, "assignedTo does not reference an existing employee.");
  }
  if (isOwningLead && !isFinanceRole(role)) {
    // A Lead may lead more than one team — the assignee must belong to any of
    // them, or be the Lead themselves (matches assignable-members' scope).
    const ownTeams = await prisma.team.findMany({
      where: { teamLeadId: session.employeeId },
      select: { id: true },
    });
    const ownTeamIds = new Set(ownTeams.map((t) => t.id));
    const inOwnTeam = assignee.teamId != null && ownTeamIds.has(assignee.teamId);
    if (!inOwnTeam && assignee.id !== session.employeeId) {
      return failFor(ErrorCode.VALIDATION, "Leads can only assign WorkItems to their own team's members.");
    }
  }

  if (mode === WorkItemMode.atomic) {
    if (taskPoints === undefined) {
      return failFor(ErrorCode.VALIDATION, "taskPoints is required for atomic-mode WorkItems.");
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

  // Metric mode: new row per period (2.1 decision — no in-place reset), so
  // periodMonth/periodYear are required at creation, not defaulted.
  if (targetValue === undefined || periodMonth === undefined || periodYear === undefined) {
    return failFor(
      ErrorCode.VALIDATION,
      "targetValue, periodMonth, and periodYear are required for metric-mode WorkItems.",
    );
  }
  const existingPeriod = await prisma.workItem.findFirst({
    where: { subUnitId: subUnit.id, assignedTo, mode: WorkItemMode.metric, periodMonth, periodYear },
  });
  if (existingPeriod) {
    return failFor(
      ErrorCode.CONFLICT,
      "A metric-mode WorkItem already exists for this employee in this period. Update it instead of creating a duplicate.",
    );
  }

  const workItem = await prisma.workItem.create({
    data: {
      subUnitId: subUnit.id,
      assignedTo,
      title,
      mode: WorkItemMode.metric,
      targetValue,
      currentValue: 0,
      periodMonth,
      periodYear,
    },
  });

  return ok(workItem, 201);
}
