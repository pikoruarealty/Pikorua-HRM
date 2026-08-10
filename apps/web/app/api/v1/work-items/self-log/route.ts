import { z } from "zod";
import { WorkItemStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { audit, clientIp } from "@/lib/audit";
import { isClockedInNow } from "@/lib/attendance/status";
import { createSelfLoggedTask } from "@/lib/work/adhoc";

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

const createSchema = z
  .object({
    // The catalog key, not an id — keys are stable and readable ("bug_fix"),
    // which keeps the client honest and the audit metadata legible.
    typeKey: z.string().trim().min(1),
    title: z.string().trim().min(3).max(200),
    // Optional, but it is what the Lead reads when answering yes/no, so the UI
    // asks for it. Empty string means "not given", not an empty description.
    description: z.string().trim().max(2000).optional(),
  })
  .strict();

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
    select: { id: true, fullName: true, departmentId: true },
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

  const type = await prisma.adhocTaskType.findUnique({ where: { key: parsed.data.typeKey } });
  if (!type || !type.active) {
    return failFor(ErrorCode.VALIDATION, "typeKey does not match an active ad-hoc task type.");
  }

  const created = await createSelfLoggedTask({
    employeeId: employee.id,
    departmentId: employee.departmentId,
    adhocTypeId: type.id,
    // Server-side, from the catalog — the client never sends a point value, so
    // a crafted request cannot inflate its own score.
    points: type.points,
    title: parsed.data.title,
    description: parsed.data.description?.trim() || null,
  });
  if (!created) {
    return failFor(
      ErrorCode.VALIDATION,
      "Your department has no active members to review self-logged work yet.",
    );
  }

  // Audited: this is an employee creating points-bearing work for themselves.
  // The Lead's later accept/reject is audited by the review route.
  await audit({
    action: "work_item.self_log",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "work_item",
    entityId: created.id,
    metadata: { typeKey: type.key, points: type.points, title: parsed.data.title },
    ip: clientIp(req),
  });

  const item = await prisma.workItem.findUnique({
    where: { id: created.id },
    include: { adhocType: { select: { key: true, label: true, points: true } } },
  });
  return ok(item, 201);
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
