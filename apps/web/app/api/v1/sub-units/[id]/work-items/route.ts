import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole, isLeadRole, rolesAtOrBelow } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { WorkItemFrequency, WorkItemMode } from "@prisma/client";

// Track B. POST /api/v1/sub-units/:id/work-items — Milestone 1.2 (atomic) + 2.2 (metric).

const currentYear = new Date().getFullYear();

const createSchema = z.object({
  title: z.string().min(1),
  // Acceptance criteria / definition of done (Pillar 1) — optional on both
  // modes; "" from an untouched form field means "not set", not an empty spec.
  description: z.string().max(2000).nullable().optional(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "dueDate must be YYYY-MM-DD")
    .nullable()
    .optional(),
  assignedTo: z.string().uuid(),
  mode: z.nativeEnum(WorkItemMode),
  // "Repeat this every day until I turn it off" (2026-08-10, owner request).
  // Only meaningful on atomic tasks: a daily-frequency metric item already
  // rolls forward by construction, so accepting the flag there would offer a
  // switch that changes nothing.
  repeatDaily: z.boolean().optional(),
  taskPoints: z.number().int().positive().optional(),
  targetValue: z.number().positive().optional(),
  frequency: z.nativeEnum(WorkItemFrequency).optional(),
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
  if (!subUnit || subUnit.deletedAt || subUnit.workUnit.deletedAt) return failFor(ErrorCode.NOT_FOUND);

  const role = session.role;
  const isProjectLead = session.employeeId === subUnit.workUnit.projectLeadId;
  if (!isFinanceRole(role) && !isProjectLead) {
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
    // Surface the specific field problem (e.g. a malformed dueDate) rather than
    // always blaming the required trio — the schema has optional fields now.
    const issue = parsed.error.issues[0];
    return failFor(
      ErrorCode.VALIDATION,
      issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "title, assignedTo, and mode are required.",
    );
  }
  const { title, assignedTo, mode, taskPoints, targetValue, frequency } = parsed.data;
  let { periodMonth, periodYear } = parsed.data;
  const description = parsed.data.description?.trim() || null;
  const dueDate = parsed.data.dueDate ? new Date(`${parsed.data.dueDate}T00:00:00.000Z`) : null;

  const assignee = await prisma.employee.findUnique({ where: { id: assignedTo } });
  if (!assignee) {
    return failFor(ErrorCode.VALIDATION, "assignedTo does not reference an existing employee.");
  }
  if (isProjectLead && !isFinanceRole(role)) {
    // The project lead can be any role (2026-08-07) — the assignee must be in
    // the WorkUnit's own department at the lead's tier or below (matches
    // assignable-members' scope), or be the lead themselves.
    const assignableRoles = rolesAtOrBelow(role);
    const inScope =
      assignee.departmentId === subUnit.workUnit.departmentId && assignableRoles.includes(assignee.role);
    if (!inScope && assignee.id !== session.employeeId) {
      return failFor(
        ErrorCode.VALIDATION,
        "Project leads can only assign WorkItems to their own department, at their level or below.",
      );
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
        description,
        // A recurring chore is due the day it appears, matching what the
        // rollover cron gives every later instance — otherwise instance one
        // would carry a date the clones don't and read as the odd one out.
        dueDate: parsed.data.repeatDaily ? (dueDate ?? new Date(new Date().toISOString().slice(0, 10))) : dueDate,
        mode: WorkItemMode.atomic,
        taskPoints,
        repeatDaily: parsed.data.repeatDaily ?? false,
      },
    });
    return ok(workItem, 201);
  }

  // Metric mode: new row per period (2.1 decision — no in-place reset), so a
  // period is required at creation, not defaulted — except for `daily`, where
  // the period is always "today" (nobody hand-picks a day for an ongoing
  // daily target; the daily-rollover cron creates every day after this one).
  if (targetValue === undefined || frequency === undefined) {
    return failFor(ErrorCode.VALIDATION, "targetValue and frequency are required for metric-mode WorkItems.");
  }
  let periodDay: number | null = null;
  if (frequency === WorkItemFrequency.daily) {
    const now = new Date();
    periodMonth = now.getUTCMonth() + 1;
    periodYear = now.getUTCFullYear();
    periodDay = now.getUTCDate();
  } else if (periodMonth === undefined || periodYear === undefined) {
    return failFor(ErrorCode.VALIDATION, "periodMonth and periodYear are required for monthly metric-mode WorkItems.");
  }

  const existingPeriod = await prisma.workItem.findFirst({
    where: {
      subUnitId: subUnit.id,
      assignedTo,
      mode: WorkItemMode.metric,
      frequency,
      periodMonth,
      periodYear,
      periodDay,
      deletedAt: null,
    },
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
      description,
      dueDate,
      mode: WorkItemMode.metric,
      targetValue,
      currentValue: 0,
      frequency,
      periodMonth,
      periodYear,
      periodDay,
    },
  });

  return ok(workItem, 201);
}
