import { z } from "zod";
import { WorkItemStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { todayDateOnly } from "@/lib/attendance/time";

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
const bodySchema = z
  .object({ workItemIds: z.array(z.string().uuid()).optional() })
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
      return failFor(ErrorCode.VALIDATION, "workItemIds must be an array of UUIDs.");
    }
    workItemIds = [...new Set(parsed.data?.workItemIds ?? [])];
  }

  // Validate selections before recording anything, so a bad id fails the whole
  // request rather than clocking in with a partial/rejected plan.
  if (workItemIds.length > 0) {
    const workItems = await prisma.workItem.findMany({ where: { id: { in: workItemIds } } });
    if (
      workItems.length !== workItemIds.length ||
      workItems.some((w) => w.assignedTo !== employeeId)
    ) {
      return failFor(ErrorCode.VALIDATION, "All workItemIds must reference WorkItems assigned to you.");
    }
  } else {
    // No tasks picked: require at least one IF the employee has active tasks to
    // pick from. Someone with nothing assigned can still clock in.
    const activeCount = await prisma.workItem.count({
      where: { assignedTo: employeeId, status: { not: WorkItemStatus.completed } },
    });
    if (activeCount > 0) {
      return fail(
        ErrorCode.VALIDATION,
        "Select at least one task for today before clocking in.",
        422,
      );
    }
  }

  const date = todayDateOnly();
  const now = new Date();

  const existing = await prisma.attendanceRecord.findUnique({
    where: { employeeId_date: { employeeId, date } },
  });

  if (existing?.clockInRaw) {
    return fail(ErrorCode.CONFLICT, "Already clocked in today.", 409);
  }

  const record = existing
    ? await prisma.attendanceRecord.update({
        where: { id: existing.id },
        data: { clockInRaw: now },
      })
    : await prisma.attendanceRecord.create({
        data: { employeeId, date, clockInRaw: now },
      });

  if (workItemIds.length > 0) {
    await prisma.dailyTaskSelection.createMany({
      data: workItemIds.map((workItemId) => ({ employeeId, workItemId, date })),
      skipDuplicates: true,
    });
  }

  return ok(record, 201);
}
