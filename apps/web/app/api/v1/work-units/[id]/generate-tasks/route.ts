import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole, isLeadRole } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { WorkItemFrequency, WorkItemMode } from "@prisma/client";
import {
  generateTaskBreakdown,
  generateProjectOutcome,
  GroqError,
  MAX_SUB_UNITS,
  MAX_ITEMS_PER_SUB_UNIT,
} from "@/lib/ai/task-generation";

// Track B. POST /api/v1/work-units/:id/generate-tasks — AI task planning.
//
// The plan lifecycle runs in three modes over one endpoint:
//   { stage: "outcome" }        → LLM proposes a "definition of done" for the
//                                 whole unit (Step 1, creator reviews/edits).
//   { stage: "tasks", expectedOutcome? } (default when not persisting)
//                               → LLM proposes a SubUnit + WorkItem breakdown,
//                                 grounded by the approved outcome (Step 2).
//   { persist: true, subUnits } → create the tree with a per-item assignee each
//                                 (Step 3, "Assign"). No LLM call.
//   { persist: true, defaultAssigneeId } → backward-compat single-assignee path
//                                 (used by the /test harness); still supported.
//
// RBAC mirrors POST /sub-units/:id/work-items — Admin/HR or the owning Lead.

const DEFAULT_TASK_POINTS = 3;
const DEFAULT_TARGET_VALUE = 100;

const persistItemSchema = z.object({
  title: z.string().min(1).max(300),
  taskPoints: z.number().positive().optional(),
  targetValue: z.number().positive().optional(),
  assignedTo: z.string().uuid(),
});
const persistSubUnitSchema = z.object({
  name: z.string().min(1).max(200),
  workItems: z.array(persistItemSchema).default([]),
});

const bodySchema = z.object({
  stage: z.enum(["outcome", "tasks"]).optional(),
  description: z.string().min(1).max(5000).optional(),
  expectedOutcome: z.string().min(1).max(5000).optional(),
  persist: z.boolean().optional(),
  defaultAssigneeId: z.string().uuid().optional(),
  subUnits: z.array(persistSubUnitSchema).optional(),
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
  if (!workUnit || workUnit.deletedAt) return failFor(ErrorCode.NOT_FOUND);

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
    body = {};
  }
  const parsed = bodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return failFor(ErrorCode.VALIDATION, "Invalid request body.");
  }
  const { stage, persist, defaultAssigneeId, subUnits, maxSubUnits, maxItemsPerSubUnit } = parsed.data;

  // Domain labels + default mode for this department type.
  const label = await prisma.departmentLabel.findUnique({
    where: { departmentTypeKey: workUnit.department.typeKey },
  });
  const mode: WorkItemMode =
    label?.workItemMode ??
    (workUnit.department.typeKey === "tech" ? WorkItemMode.atomic : WorkItemMode.metric);

  // For a Lead, the teams they lead — assignees must belong to one of them (or
  // be the Lead themselves). A Lead can lead more than one team. Resolved once.
  const ownTeamIds =
    isOwningLead && !isFinanceRole(role)
      ? new Set(
          (
            await prisma.team.findMany({
              where: { teamLeadId: session.employeeId! },
              select: { id: true },
            })
          ).map((t) => t.id),
        )
      : null;

  async function validateAssignee(assigneeId: string): Promise<string | null> {
    const assignee = await prisma.employee.findUnique({
      where: { id: assigneeId },
      select: { id: true, teamId: true },
    });
    if (!assignee) return "An assignee does not reference an existing employee.";
    if (ownTeamIds) {
      const inOwnTeam = assignee.teamId != null && ownTeamIds.has(assignee.teamId);
      if (!inOwnTeam && assignee.id !== session!.employeeId) {
        return "Leads can only assign tasks to their own team's members.";
      }
    }
    return null;
  }

  // ---- Persist (Step 3): per-item assignees, or backward-compat single ----
  if (persist) {
    const now = new Date();
    const periodMonth = now.getUTCMonth() + 1;
    const periodYear = now.getUTCFullYear();

    if (subUnits && subUnits.length > 0) {
      // Validate every distinct assignee up front.
      const assigneeIds = [...new Set(subUnits.flatMap((su) => su.workItems.map((wi) => wi.assignedTo)))];
      for (const id of assigneeIds) {
        const err = await validateAssignee(id);
        if (err) return failFor(ErrorCode.VALIDATION, err);
      }

      const created = await prisma.$transaction(async (tx) => {
        const out = [];
        for (const su of subUnits) {
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
                      assignedTo: wi.assignedTo,
                      title: wi.title,
                      mode: WorkItemMode.atomic,
                      taskPoints: wi.taskPoints ? Math.max(1, Math.round(wi.taskPoints)) : DEFAULT_TASK_POINTS,
                    }
                  : {
                      subUnitId: subUnit.id,
                      assignedTo: wi.assignedTo,
                      title: wi.title,
                      mode: WorkItemMode.metric,
                      targetValue: wi.targetValue ?? DEFAULT_TARGET_VALUE,
                      currentValue: 0,
                      frequency: WorkItemFrequency.monthly,
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

      return ok({ workUnitId: workUnit.id, mode, persisted: true, subUnits: created }, 201);
    }

    // Backward-compat: single default assignee, re-runs the LLM.
    if (!defaultAssigneeId) {
      return failFor(
        ErrorCode.VALIDATION,
        "Provide subUnits (with a per-item assignedTo) or defaultAssigneeId to persist.",
      );
    }
    const err = await validateAssignee(defaultAssigneeId);
    if (err) return failFor(ErrorCode.VALIDATION, err);

    const description = (parsed.data.description ?? workUnit.description ?? "").trim();
    if (!description) {
      return failFor(ErrorCode.VALIDATION, "No project description available.");
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
        expectedOutcome: parsed.data.expectedOutcome,
        maxSubUnits,
        maxItemsPerSubUnit,
      });
    } catch (e) {
      if (e instanceof GroqError) return fail(ErrorCode.INTERNAL, `Task generation failed: ${e.message}`, 502);
      throw e;
    }

    const created = await prisma.$transaction(async (tx) => {
      const out = [];
      for (const su of breakdown.subUnits) {
        const subUnit = await tx.subUnit.create({ data: { workUnitId: workUnit.id, name: su.name } });
        const items = [];
        for (const wi of su.workItems) {
          const workItem = await tx.workItem.create({
            data:
              mode === WorkItemMode.atomic
                ? {
                    subUnitId: subUnit.id,
                    assignedTo: defaultAssigneeId,
                    title: wi.title,
                    mode: WorkItemMode.atomic,
                    taskPoints: wi.taskPoints ?? DEFAULT_TASK_POINTS,
                  }
                : {
                    subUnitId: subUnit.id,
                    assignedTo: defaultAssigneeId,
                    title: wi.title,
                    mode: WorkItemMode.metric,
                    targetValue: wi.targetValue ?? DEFAULT_TARGET_VALUE,
                    currentValue: 0,
                    frequency: WorkItemFrequency.monthly,
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

    return ok({ workUnitId: workUnit.id, mode, persisted: true, assignedTo: defaultAssigneeId, subUnits: created }, 201);
  }

  // ---- Draft modes (no DB writes) ----
  const description = (parsed.data.description ?? workUnit.description ?? "").trim();
  if (!description) {
    return failFor(
      ErrorCode.VALIDATION,
      "No project description available. Provide `description` in the request or set it on the WorkUnit first.",
    );
  }

  // Step 1: expected-outcome draft.
  if (stage === "outcome") {
    try {
      const { expectedOutcome } = await generateProjectOutcome({
        projectName: workUnit.name,
        description,
        workUnitLabel: label?.workUnitLabel ?? "Project",
      });
      return ok({ workUnitId: workUnit.id, expectedOutcome });
    } catch (e) {
      if (e instanceof GroqError) return fail(ErrorCode.INTERNAL, `Outcome generation failed: ${e.message}`, 502);
      throw e;
    }
  }

  // Step 2: task breakdown draft (grounded by the approved outcome if provided).
  let breakdown;
  try {
    breakdown = await generateTaskBreakdown({
      projectName: workUnit.name,
      description,
      mode,
      workUnitLabel: label?.workUnitLabel ?? "Project",
      subUnitLabel: label?.subUnitLabel ?? "Sub-unit",
      workItemLabel: label?.workItemLabel ?? "Task",
      expectedOutcome: parsed.data.expectedOutcome,
      maxSubUnits,
      maxItemsPerSubUnit,
    });
  } catch (err) {
    if (err instanceof GroqError) {
      return fail(ErrorCode.INTERNAL, `Task generation failed: ${err.message}`, 502);
    }
    throw err;
  }

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
