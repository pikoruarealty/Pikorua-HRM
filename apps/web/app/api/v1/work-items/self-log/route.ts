import { z } from "zod";
import { WorkItemStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { audit, clientIp } from "@/lib/audit";
import { isClockedInNow } from "@/lib/attendance/status";
import { todayDateOnly } from "@/lib/attendance/time";
import { createSelfLoggedTask, createFreeTextSelfLoggedTask } from "@/lib/work/adhoc";
import { estimateSelfLoggedEffort, GroqError, type SelfLoggedEffort } from "@/lib/ai/task-generation";
import { dailyCapHours, fitToDailyCap, hoursClaimed, pointsToHours } from "@/lib/work/self-log-scoring";
import { shiftHoursFor } from "@/lib/attendance/expected-hours";

// POST /api/v1/work-items/self-log (2026-08-10) — an employee logs work nobody
// assigned them. Owner request: "for the tech employees if no tasks assigned,
// employees can log new tasks themselves while clock in or during the day, but
// need to figure out the point system for that."
//
// The point system in one sentence: the employee picks a **type** from a fixed
// catalog, never a number, and the Lead's only judgement at review is "did this
// happen, yes or no". See lib/work/adhoc.ts for why it is built that way.
//
// GET is the employee's own self-logged list, so the UI can show what is
// pending review without loading the whole work tree.

// typeKey omitted = free-text mode: "did something that doesn't fit the
// catalog" (2026-08-14, owner request). There is no priced type to lean on,
// so the Lead has to actually read what happened before crediting anything —
// the description is the whole basis for that judgement, hence the higher
// minimum length than the catalog path's optional one.
const createSchema = z
  .object({
    // The catalog key, not an id — keys are stable and readable ("bug_fix"),
    // which keeps the client honest and the audit metadata legible.
    typeKey: z.string().trim().min(1).optional(),
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine((v) => v.typeKey || (v.description && v.description.length >= 20), {
    message: "description: describe what you did in at least 20 characters when not picking a type.",
    path: ["description"],
  });

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!session.employeeId) {
    return failFor(ErrorCode.FORBIDDEN, "No employee record linked to this account.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return failFor(
      ErrorCode.VALIDATION,
      issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "Invalid request body.",
    );
  }

  const employee = await prisma.employee.findUnique({
    where: { id: session.employeeId },
    select: {
      id: true,
      fullName: true,
      departmentId: true,
      team: { select: { expectedStartTime: true, expectedEndTime: true } },
    },
  });
  if (!employee?.departmentId) {
    // Admin/HR have no department and therefore no ad-hoc container or
    // reviewing Lead. They are not the audience for this feature.
    return failFor(
      ErrorCode.FORBIDDEN,
      "Only employees in a department can log ad-hoc tasks.",
    );
  }

  // Checked after the department test on purpose: "you have no department" is a
  // permanent answer about who this feature is for, while "you are not clocked
  // in" is a transient one. Leading with the transient message would tell an
  // Admin to clock in for a feature that would refuse them anyway.
  //
  // Same rule as completing a task: you log work while you are at work. It also
  // keeps the logged date honest — a task logged on a day you never clocked in
  // has no attendance to hang off and would distort the daily view.
  if (!(await isClockedInNow(session.employeeId))) {
    return fail(ErrorCode.VALIDATION, "You must be clocked in to log a task.", 422);
  }

  // One working day can only carry so much effort (lib/work/self-log-scoring.ts):
  // production had 25 entries / 149 points from one person in a day, each a
  // slice of the same feature. Today's earlier entries — catalog or free-text —
  // use up the ceiling, whatever they were worth.
  const earlierToday = (
    await prisma.dailyTaskSelection.findMany({
      where: {
        employeeId: employee.id,
        date: todayDateOnly(),
        workItem: { selfLogged: true, deletedAt: null, taskPoints: { not: null } },
      },
      select: { workItem: { select: { title: true, taskPoints: true } } },
    })
  ).map((s) => ({ title: s.workItem.title, points: s.workItem.taskPoints ?? 0 }));
  const capHours = dailyCapHours(shiftHoursFor(employee.team?.expectedStartTime, employee.team?.expectedEndTime));
  const remainingHours = capHours - hoursClaimed(earlierToday.map((e) => e.points));
  const limitMessage = (left: number) =>
    left < 0.5
      ? `You've already logged about ${capHours}h of work today, the most one day can carry.`
      : `Only about ${left}h of today's ${capHours}h limit is left — too little for that task.`;

  let created: { id: string } | null;
  let auditMetadata: {
    typeKey: string | null;
    title: string;
    points?: number;
    aiEstimated?: boolean;
    hours?: number;
    overlap?: boolean;
    clamped?: boolean;
  };
  let sizing: { hours: number | null; overlap: boolean; clamped: boolean; remainingHours: number } | null = null;

  if (parsed.data.typeKey) {
    const type = await prisma.adhocTaskType.findUnique({ where: { key: parsed.data.typeKey } });
    if (!type || !type.active) {
      return failFor(ErrorCode.VALIDATION, "typeKey does not match an active ad-hoc task type.");
    }
    if (pointsToHours(type.points) > remainingHours) {
      return fail(ErrorCode.VALIDATION, limitMessage(remainingHours), 422);
    }
    created = await createSelfLoggedTask({
      employeeId: employee.id,
      departmentId: employee.departmentId,
      adhocTypeId: type.id,
      // Server-side, from the catalog — the client never sends a point value, so
      // a crafted request cannot inflate its own score.
      points: type.points,
      title: parsed.data.title,
      description: parsed.data.description?.trim() || null,
    });
    auditMetadata = { typeKey: type.key, points: type.points, title: parsed.data.title };
    sizing = {
      hours: null,
      overlap: false,
      clamped: false,
      remainingHours: Math.round((remainingHours - pointsToHours(type.points)) * 10) / 10,
    };
  } else {
    // Free-text: no longer capped at one open claim at a time (2026-08-16,
    // owner request — the cap blocked a second log the moment the first was
    // logged, even before it had been submitted for review, which felt like a
    // bug more than a guardrail). Aggregate self-logged points are still
    // bounded by performance_config.self_logged_cap_percent.
    const description = parsed.data.description!.trim();
    if (remainingHours < 0.5) {
      return fail(ErrorCode.VALIDATION, limitMessage(remainingHours), 422);
    }
    let effort: SelfLoggedEffort;
    try {
      effort = await estimateSelfLoggedEffort({ title: parsed.data.title, description }, { earlierToday });
    } catch (err) {
      if (err instanceof GroqError) {
        return failFor(
          ErrorCode.VALIDATION,
          "Could not size this task automatically right now. Try again in a moment.",
        );
      }
      throw err;
    }
    const fit = fitToDailyCap(effort.hours, remainingHours);
    if (!fit.allowed) {
      return fail(ErrorCode.VALIDATION, limitMessage(fit.remainingHours), 422);
    }
    const points = fit.points;
    created = await createFreeTextSelfLoggedTask({
      employeeId: employee.id,
      departmentId: employee.departmentId,
      title: parsed.data.title,
      description,
      points,
    });
    auditMetadata = {
      typeKey: null,
      title: parsed.data.title,
      points,
      aiEstimated: true,
      hours: fit.hours,
      overlap: effort.overlap,
      clamped: fit.clamped,
    };
    sizing = {
      hours: fit.hours,
      overlap: effort.overlap,
      clamped: fit.clamped,
      remainingHours: Math.round((remainingHours - pointsToHours(points)) * 10) / 10,
    };
  }
  if (!created) {
    return failFor(
      ErrorCode.VALIDATION,
      "Your department has no active members to review self-logged work yet.",
    );
  }

  // What you log yourself is what you are working on, so it goes straight onto
  // today's plan (2026-09-30, owner request) — the employee used to have to go
  // back to Daily Planning and pick their own just-logged task. Same additive
  // skipDuplicates write POST /daily-selections and clock-in use. The caller is
  // clocked in (checked above), so today's record and the plan already exist.
  await prisma.dailyTaskSelection.createMany({
    data: [{ employeeId: employee.id, workItemId: created.id, date: todayDateOnly() }],
    skipDuplicates: true,
  });

  // Audited: this is an employee creating points-bearing work for themselves.
  // The Lead's later accept/reject is audited by the review route.
  await audit({
    action: "work_item.self_log",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "work_item",
    entityId: created.id,
    metadata: auditMetadata,
    ip: clientIp(req),
  });

  const item = await prisma.workItem.findUnique({
    where: { id: created.id },
    include: { adhocType: { select: { key: true, label: true, points: true } } },
  });
  return ok({ ...item, sizing }, 201);
}

export async function GET() {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!session.employeeId) {
    return failFor(ErrorCode.FORBIDDEN, "No employee record linked to this account.");
  }

  const items = await prisma.workItem.findMany({
    where: { assignedTo: session.employeeId, selfLogged: true, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { adhocType: { select: { key: true, label: true, points: true } } },
  });
  return ok(
    items.map((i) => ({
      id: i.id,
      title: i.title,
      description: i.description,
      status: i.status,
      taskPoints: i.taskPoints,
      // `completed` here means the Lead accepted it — points only exist after
      // that, so the UI can say "awaiting review" without a second lookup.
      awaitingReview: i.status === WorkItemStatus.in_review,
      reviewNote: i.reviewNote,
      createdAt: i.createdAt,
      type: i.adhocType,
    })),
  );
}
