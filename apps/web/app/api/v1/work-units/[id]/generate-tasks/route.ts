import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole, isLeadRole } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { WorkItemMode } from "@prisma/client";
import {
  generateTaskBreakdown,
  GroqError,
  MAX_SUB_UNITS,
  MAX_ITEMS_PER_SUB_UNIT,
} from "@/lib/ai/task-generation";

// Track B. POST /api/v1/work-units/:id/generate-tasks — AI task generation.
//
// Takes a WorkUnit's brief (body.description, else the stored WorkUnit.description)
// and asks the LLM to propose a SubUnit + WorkItem breakdown.
//
// Default (persist omitted/false): returns the DRAFT only, no DB writes — the
// Lead reviews and creates via the normal endpoints (or re-calls with persist).
// persist=true: creates the SubUnits + WorkItems, all assigned to
// defaultAssigneeId (required in that case), using the same team-membership
// rule as the manual work-item route. LLM point/target suggestions are used
// where present, else a sensible default is applied.
//
// RBAC mirrors POST /sub-units/:id/work-items — Admin/HR or the owning Lead.

// Fallbacks when the model omits a per-item estimate.
const DEFAULT_TASK_POINTS = 3;
const DEFAULT_TARGET_VALUE = 100;

const bodySchema = z.object({
  description: z.string().min(1).max(5000).optional(),
  persist: z.boolean().optional(),
  defaultAssigneeId: z.string().uuid().optional(),
  maxSubUnits: z.number().int().min(1).max(MAX_SUB_UNITS).optional(),
  maxItemsPerSubUnit: z.number().int().min(1).max(MAX_ITEMS_PER_SUB_UNIT).optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const workUnit = await prisma.workUnit.findUnique({
    where: { id: params.id },
    include: { department: true },
  });
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
    // An empty body is fine (defaults to the stored description, draft mode).
    body = {};
  }
  const parsed = bodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return failFor(ErrorCode.VALIDATION, "Invalid request body.");
  }
  const { persist, defaultAssigneeId, maxSubUnits, maxItemsPerSubUnit } = parsed.data;

  const description = (parsed.data.description ?? workUnit.description ?? "").trim();
  if (!description) {
    return failFor(
      ErrorCode.VALIDATION,
      "No project description available. Provide `description` in the request or set it on the WorkUnit first.",
    );
  }

  // Domain labels + default mode for this department type (Project/Feature/Task
  // vs Campaign/Segment/Call, and atomic vs metric).
  const label = await prisma.departmentLabel.findUnique({
    where: { departmentTypeKey: workUnit.department.typeKey },
  });
  const mode: WorkItemMode =
    label?.workItemMode ??
    (workUnit.department.typeKey === "tech" ? WorkItemMode.atomic : WorkItemMode.metric);

  // Validate the persist assignee up front so we don't spend an LLM call on a
  // request that can't complete.
  let assignee: { id: string; teamId: string | null } | null = null;
  if (persist) {
    if (!defaultAssigneeId) {
      return failFor(
        ErrorCode.VALIDATION,
        "defaultAssigneeId is required when persist is true (every WorkItem needs an assignee).",
      );
    }
    assignee = await prisma.employee.findUnique({
      where: { id: defaultAssigneeId },
      select: { id: true, teamId: true },
    });
    if (!assignee) {
      return failFor(ErrorCode.VALIDATION, "defaultAssigneeId does not reference an existing employee.");
    }
    if (isOwningLead && !isFinanceRole(role)) {
      const ownTeam = await prisma.team.findFirst({ where: { teamLeadId: session.employeeId } });
      if (!ownTeam || assignee.teamId !== ownTeam.id) {
        return failFor(ErrorCode.VALIDATION, "Leads can only assign WorkItems to their own team's members.");
      }
    }
  }

  let breakdown;
  try {
    breakdown = await generateTaskBreakdown({
      projectName: workUnit.name,
      description,
      mode,
      workUnitLabel: label?.workUnitLabel ?? "Project",
      subUnitLabel: label?.subUnitLabel ?? "Sub-unit",
      workItemLabel: label?.workItemLabel ?? "Task",
      maxSubUnits,
      maxItemsPerSubUnit,
    });
  } catch (err) {
    if (err instanceof GroqError) {
      // Upstream/model failure — surface as 502 (bad gateway) so the client can
      // distinguish it from its own 4xx validation errors.
      return fail(ErrorCode.INTERNAL, `Task generation failed: ${err.message}`, 502);
    }
    throw err;
  }

  // Draft mode (default): return the proposal without writing anything.
  if (!persist) {
    return ok({
      workUnitId: workUnit.id,
      mode,
      persisted: false,
      labels: {
        workUnit: label?.workUnitLabel ?? "Project",
        subUnit: label?.subUnitLabel ?? "Sub-unit",
        workItem: label?.workItemLabel ?? "Task",
      },
      subUnits: breakdown.subUnits,
    });
  }

  // Persist mode: create the whole tree in one transaction, assigned to
  // defaultAssigneeId. Metric items are scoped to the current period.
  const now = new Date();
  const periodMonth = now.getUTCMonth() + 1;
  const periodYear = now.getUTCFullYear();

  const created = await prisma.$transaction(async (tx) => {
    const out = [];
    for (const su of breakdown.subUnits) {
      const subUnit = await tx.subUnit.create({
        data: { workUnitId: workUnit.id, name: su.name },
      });
      const items = [];
      for (const wi of su.workItems) {
        const workItem = await tx.workItem.create({
          data:
            mode === WorkItemMode.atomic
              ? {
                  subUnitId: subUnit.id,
                  assignedTo: assignee!.id,
                  title: wi.title,
                  mode: WorkItemMode.atomic,
                  taskPoints: wi.taskPoints ?? DEFAULT_TASK_POINTS,
                }
              : {
                  subUnitId: subUnit.id,
                  assignedTo: assignee!.id,
                  title: wi.title,
                  mode: WorkItemMode.metric,
                  targetValue: wi.targetValue ?? DEFAULT_TARGET_VALUE,
                  currentValue: 0,
                  periodMonth,
                  periodYear,
                },
        });
        items.push(workItem);
      }
      out.push({ ...subUnit, workItems: items });
    }
    return out;
  });

  return ok(
    {
      workUnitId: workUnit.id,
      mode,
      persisted: true,
      assignedTo: assignee!.id,
      subUnits: created,
    },
    201,
  );
}
