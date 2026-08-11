import { z } from "zod";
import { AttendanceApprovalStatus, WorkItemStatus, WorkLocation } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { todayDateOnly } from "@/lib/attendance/time";
import { findOpenSession } from "@/lib/attendance/sessions";

// Track A. POST /api/v1/attendance/clock-in — any authenticated user with a
// linked employee record clocks themselves in (attendance applies org-wide,
// not just "employee"-role individual contributors — Leads/Admin/HR are
// employees too). Server-timestamped; never trust a client-supplied time.
//
// PRD §5.4: at clock-in the employee selects the WorkItems they intend to work
// on today, written into today's DailyTaskSelection (same additive/skipDuplicates
// semantics as POST /daily-selections). Selecting at least one task is REQUIRED
// when the employee has any active (non-completed) assigned tasks; an employee
// with nothing assigned can still clock in (they have nothing to pick).
//
// 2026-08-11: clocking out is no longer the end of the day. Each clock-in opens
// an AttendanceSession and each clock-out closes it, so an employee can step out
// and come back as often as they need; only the open session gates progress
// logging ("you may clock in again, but you can't log work while clocked out").
// `workLocation` marks the session as office or work-from-home — a WFH day is a
// normally worked, normally paid day, it just never comes off the biometric
// device.
const bodySchema = z
  .object({
    workItemIds: z.array(z.string().uuid()).optional(),
    workLocation: z.nativeEnum(WorkLocation).optional(),
  })
  .strict()
  .optional();

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return failFor(ErrorCode.UNAUTHENTICATED);
  }
  if (!session.employeeId) {
    return failFor(ErrorCode.FORBIDDEN, "No employee record linked to this account.");
  }
  const employeeId = session.employeeId;

  // Body is optional — a bare clock-in with no task selection is still valid.
  let workItemIds: string[] = [];
  let workLocation: WorkLocation = WorkLocation.office;
  const raw = await req.text();
  if (raw.trim().length > 0) {
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(raw);
    } catch {
      return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
    }
    const parsed = bodySchema.safeParse(parsedBody);
    if (!parsed.success) {
      return failFor(
        ErrorCode.VALIDATION,
        "workItemIds must be an array of UUIDs and workLocation one of: office, wfh.",
      );
    }
    workItemIds = [...new Set(parsed.data?.workItemIds ?? [])];
    workLocation = parsed.data?.workLocation ?? WorkLocation.office;
  }

  const date = todayDateOnly();
  const now = new Date();

  const existing = await prisma.attendanceRecord.findUnique({
    where: { employeeId_date: { employeeId, date } },
  });

  if (existing && (await findOpenSession(existing.id))) {
    return fail(ErrorCode.CONFLICT, "Already clocked in today.", 409);
  }

  // Reopening an approved day would silently invalidate the approved times
  // (and the payroll figures derived from them) with no one reviewing the
  // change. Admin/HR can reopen it via PATCH /attendance/:id/edit instead.
  if (existing?.approvalStatus === AttendanceApprovalStatus.approved) {
    return fail(
      ErrorCode.CONFLICT,
      "Today's attendance has already been approved — ask Admin/HR to reopen it.",
      409,
    );
  }

  // Whether this opens the day or resumes it. Resuming skips the "pick a task"
  // requirement — the day's plan was already made at the first clock-in, and
  // making someone re-plan after a lunch break is friction, not discipline.
  const isFirstSessionToday = !existing?.clockInRaw;

  // Validate selections before recording anything, so a bad id fails the whole
  // request rather than clocking in with a partial/rejected plan.
  if (workItemIds.length > 0) {
    const workItems = await prisma.workItem.findMany({ where: { id: { in: workItemIds }, deletedAt: null } });
    if (
      workItems.length !== workItemIds.length ||
      workItems.some((w) => w.assignedTo !== employeeId)
    ) {
      return failFor(ErrorCode.VALIDATION, "All workItemIds must reference WorkItems assigned to you.");
    }
  } else if (isFirstSessionToday) {
    // No tasks picked: require at least one IF the employee has active tasks to
    // pick from. Someone with nothing assigned can still clock in.
    // `in_review` counts as not-actionable alongside `completed`: the task is
    // out of the employee's hands until their lead accepts or sends it back, so
    // it can't be what they plan to work on today.
    const activeCount = await prisma.workItem.count({
      where: {
        assignedTo: employeeId,
        status: { notIn: [WorkItemStatus.completed, WorkItemStatus.in_review] },
        deletedAt: null,
      },
    });
    if (activeCount > 0) {
      return fail(
        ErrorCode.VALIDATION,
        "Select at least one task for today before clocking in.",
        422,
      );
    }
  }

  const record = existing
    ? await prisma.attendanceRecord.update({
        where: { id: existing.id },
        data: {
          // clock_in_raw is the day's FIRST punch in — late-arrival is measured
          // from it, so a post-lunch return must never overwrite it.
          ...(existing.clockInRaw ? {} : { clockInRaw: now, workLocation }),
          // The day is open again: it has no end time, and its worked hours are
          // not final. Both are recomputed from the sessions at clock-out.
          clockOutRaw: null,
          totalHours: null,
          isHalfDay: false,
        },
      })
    : await prisma.attendanceRecord.create({
        data: { employeeId, date, clockInRaw: now, workLocation },
      });

  const openSession = await prisma.attendanceSession.create({
    data: { recordId: record.id, clockIn: now, workLocation },
  });

  if (workItemIds.length > 0) {
    await prisma.dailyTaskSelection.createMany({
      data: workItemIds.map((workItemId) => ({ employeeId, workItemId, date })),
      skipDuplicates: true,
    });
  }

  return ok({ ...record, currentSession: openSession }, 201);
}
