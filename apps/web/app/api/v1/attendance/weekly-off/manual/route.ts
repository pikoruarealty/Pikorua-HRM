import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { requireRole, FINANCE_ROLES, AuthzError } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { weekStartOf } from "@/lib/attendance/week";
import { audit, clientIp } from "@/lib/audit";
import { pushNotification } from "@/lib/notifications/push";

// Owner request, 2026-09-01. POST /api/v1/attendance/weekly-off/manual —
// Admin/HR backfill of a weekly-off record for a day an employee actually
// took off but never claimed via the self-service flow (GET/POST
// .../weekly-off) at the time. Mirrors the attendance/manual pattern:
// pre-approved by construction (Admin/HR entering it IS the approval), a
// required `reason` that's audit-only (WeeklyOffMove has no reason column),
// and an `override` flag to confirm overwriting a conflict rather than
// silently clobbering it.
const manualSchema = z.object({
  employee_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  reason: z.string().min(3, "A reason is required for a manual weekly-off record."),
  override: z.boolean().optional(),
});

export async function POST(req: Request) {
  const session = await getSession();
  try {
    requireRole(session, FINANCE_ROLES);
  } catch (err) {
    if (err instanceof AuthzError) return failFor(err.kind);
    throw err;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
  }
  const parsed = manualSchema.safeParse(body);
  if (!parsed.success) {
    return failFor(ErrorCode.VALIDATION, parsed.error.issues[0]?.message ?? "Invalid weekly-off record.");
  }
  const d = parsed.data;

  const employee = await prisma.employee.findUnique({
    where: { id: d.employee_id },
    select: { id: true, fullName: true, user: { select: { id: true } } },
  });
  if (!employee) return failFor(ErrorCode.VALIDATION, "employee_id does not reference an existing employee.");

  const date = new Date(`${d.date}T00:00:00.000Z`);
  const weekStart = weekStartOf(date);

  // A day the employee actually worked (clocked in) isn't a day off — this
  // almost always means the wrong date was entered.
  const attendance = await prisma.attendanceRecord.findUnique({
    where: { employeeId_date: { employeeId: d.employee_id, date } },
    select: { clockInRaw: true },
  });
  if (attendance?.clockInRaw && !d.override) {
    return fail(
      ErrorCode.CONFLICT,
      "This employee has a clock-in on that date. Pass override=true if this is genuinely correct.",
      409,
    );
  }

  const existing = await prisma.weeklyOffMove.findUnique({
    where: { employeeId_weekStart: { employeeId: d.employee_id, weekStart } },
  });
  if (existing?.active && existing.date.getTime() !== date.getTime() && !d.override) {
    return fail(
      ErrorCode.CONFLICT,
      `This employee already has ${existing.date.toISOString().slice(0, 10)} recorded as their off day for this week. Pass override=true to move it.`,
      409,
    );
  }

  const move = await prisma.weeklyOffMove.upsert({
    where: { employeeId_weekStart: { employeeId: d.employee_id, weekStart } },
    create: { employeeId: d.employee_id, weekStart, date, active: true },
    update: { date, active: true, revertedById: null, revertedAt: null },
  });

  await audit({
    action: existing ? "attendance.weekly_off_manual_override" : "attendance.weekly_off_manual_create",
    actorUserId: session!.userId,
    actorRole: session!.role,
    entityType: "weekly_off_move",
    entityId: move.id,
    metadata: {
      employee_id: d.employee_id,
      date: d.date,
      week_start: weekStart.toISOString().slice(0, 10),
      reason: d.reason,
      ...(existing ? { date_before: existing.date.toISOString().slice(0, 10) } : {}),
    },
    ip: clientIp(req),
  });

  if (employee.user) {
    await pushNotification(
      employee.user.id,
      "weekly_off_claimed",
      `Admin/HR recorded ${d.date} as your weekly off for that week.`,
      "Weekly Off Recorded",
    ).catch(() => {});
  }

  return ok(move, existing ? 200 : 201);
}
