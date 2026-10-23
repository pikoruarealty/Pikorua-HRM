import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { isUuid } from "@/lib/api/params";
import { audit, clientIp } from "@/lib/audit";
import { weekStartOf } from "@/lib/attendance/week";
import { getActualWfhHoursForWeek, getWfhWeeklyCap, countedWfhHours } from "@/lib/attendance/wfh-hours";
import { ATTENDANCE_EXEMPT_MESSAGE, isAttendanceExemptRole } from "@/lib/attendance/tracking";

// PUT /api/v1/attendance/:employee_id/wfh-hours/extra (2026-10-24) — Admin only.
// Only `wfhWeeklyCapHours` of a week's WFH time counts toward the WFH-hours target;
// this lets Admin count more of what the employee really worked that week. Setting
// 0 removes an earlier approval. The extra can't exceed the hours actually worked
// over the cap (nothing can be "approved" that wasn't worked). Tracking only — it
// has no payroll effect — but it is still an Admin decision, so it is audited.
const putSchema = z.object({
  week_start: z.coerce.date(),
  extra_hours: z.coerce.number().min(0).max(168),
  reason: z.string().trim().max(500).optional(),
});

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!isAdmin(session.role)) return failFor(ErrorCode.FORBIDDEN, "Only Admin can approve extra WFH hours.");
  if (!isUuid(params.id)) return failFor(ErrorCode.NOT_FOUND);

  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return failFor(ErrorCode.VALIDATION, "week_start (a date) and extra_hours (0 or more) are required.");

  const employee = await prisma.employee.findUnique({ where: { id: params.id }, select: { role: true } });
  if (!employee) return failFor(ErrorCode.NOT_FOUND, "Employee not found.");
  if (isAttendanceExemptRole(employee.role)) return failFor(ErrorCode.NOT_FOUND, ATTENDANCE_EXEMPT_MESSAGE);

  const weekStart = weekStartOf(parsed.data.week_start);
  const [actual, cap] = await Promise.all([
    getActualWfhHoursForWeek(params.id, weekStart),
    getWfhWeeklyCap(weekStart),
  ]);
  const headroom = Math.max(0, Math.round((actual - cap) * 100) / 100);
  const extra = parsed.data.extra_hours;
  if (extra > headroom) {
    return fail(
      ErrorCode.VALIDATION,
      headroom === 0
        ? `Only ${actual}h were worked from home that week, which is within the ${cap}h cap — there is nothing over it to approve.`
        : `Only ${headroom}h were worked over the ${cap}h cap that week (${actual}h in total), so at most ${headroom}h can be approved.`,
      422,
    );
  }

  const key = { employeeId_weekStart: { employeeId: params.id, weekStart } };
  const before = await prisma.wfhWeeklyApproval.findUnique({ where: key, select: { extraHours: true } });
  if (extra === 0) {
    if (before) await prisma.wfhWeeklyApproval.delete({ where: key });
  } else {
    await prisma.wfhWeeklyApproval.upsert({
      where: key,
      create: {
        employeeId: params.id,
        weekStart,
        extraHours: extra,
        approvedById: session.userId,
        reason: parsed.data.reason ?? null,
      },
      update: { extraHours: extra, approvedById: session.userId, reason: parsed.data.reason ?? null },
    });
  }

  await audit({
    action: "attendance.wfh_extra_hours",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "employee",
    entityId: params.id,
    metadata: {
      week_start: weekStart.toISOString().slice(0, 10),
      extra_hours: extra,
      previous_extra_hours: before ? Number(before.extraHours) : 0,
      actual_hours: actual,
      cap_hours: cap,
      reason: parsed.data.reason ?? null,
    },
    ip: clientIp(req),
  });

  return ok({
    week_start: weekStart.toISOString().slice(0, 10),
    actual_hours: actual,
    cap_hours: cap,
    approved_extra_hours: extra,
    counted_hours: countedWfhHours(actual, cap, extra),
  });
}
