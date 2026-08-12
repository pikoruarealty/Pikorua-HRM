import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { requireRole, AuthzError, FINANCE_ROLES } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { computeHours, isImplausibleDuration, MAX_PLAUSIBLE_SHIFT_HOURS } from "@/lib/attendance/time";
import { summariseSessions } from "@/lib/attendance/sessions";
import { audit, clientIp } from "@/lib/audit";

// Track A. PATCH /api/v1/attendance/:id/edit — Admin/HR. Edits the
// clock_in_approved/clock_out_approved times (e.g. correcting a forgotten
// clock-out), defaulting to the existing approved value (or raw, if never
// edited) when a field is omitted. Raw values are never overwritten — kept
// for audit. total_hours/is_half_day are recomputed from the resulting
// effective (approved-or-raw) times, since that's what payroll will read
// once the record is approved.
// is_compensation (2026-08-07): admin manual override — marks this record as
// a compensation day (paid at the normal per-day rate, same as a Sunday
// clock-in auto-detected in lib/attendance/monthly-breakdown.ts) regardless
// of what day of the week it actually falls on. See that file's classifyMonth
// for how this flag is combined with the automatic Sunday detection.
// late_exempt (2026-08-12): Admin/HR override for a late clock-in that
// wasn't the employee's fault (e.g. office inaccessible) — waives the late
// deduction without requiring the employee to compensate by staying late.
// late_exempt_reason is free text, shown alongside the flag; not required
// by the schema (mirrors flagReason's optionality) but the UI always
// collects one.
const editSchema = z.object({
  clock_in_approved: z.string().datetime().nullable().optional(),
  clock_out_approved: z.string().datetime().nullable().optional(),
  is_compensation: z.boolean().optional(),
  late_exempt: z.boolean().optional(),
  late_exempt_reason: z.string().nullable().optional(),
  // 2026-08-12: confirms an implausibly long (>14h) resulting span is
  // intentional — same guard/rationale as the manual-entry routes' flag of
  // the same name. Editing is also how flaggedForReview records get fixed,
  // so this only fires when the CORRECTED times are still implausible.
  confirm_long_duration: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
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

  const parsed = editSchema.safeParse(body);
  if (!parsed.success) {
    return failFor(
      ErrorCode.VALIDATION,
      "clock_in_approved and/or clock_out_approved must be valid ISO datetimes.",
    );
  }

  const existing = await prisma.attendanceRecord.findUnique({ where: { id: params.id } });
  if (!existing) {
    return failFor(ErrorCode.NOT_FOUND, "Attendance record not found.");
  }

  const clockInApproved =
    parsed.data.clock_in_approved !== undefined
      ? parsed.data.clock_in_approved
        ? new Date(parsed.data.clock_in_approved)
        : null
      : existing.clockInApproved;
  const clockOutApproved =
    parsed.data.clock_out_approved !== undefined
      ? parsed.data.clock_out_approved
        ? new Date(parsed.data.clock_out_approved)
        : null
      : existing.clockOutApproved;

  const effectiveIn = clockInApproved ?? existing.clockInRaw;
  const effectiveOut = clockOutApproved ?? existing.clockOutRaw;
  if (effectiveIn && effectiveOut && effectiveOut <= effectiveIn) {
    return failFor(
      ErrorCode.VALIDATION,
      "The resulting clock-out time must be after the clock-in time.",
    );
  }

  // A day can be several sessions (2026-08-11), so out-minus-in is the span of
  // the day, breaks included — using it would pay a two-hour lunch as work.
  // Recompute from the sessions UNLESS this request explicitly sets an approved
  // time, in which case the admin's stated times are the correction and win.
  const timesEdited =
    parsed.data.clock_in_approved !== undefined || parsed.data.clock_out_approved !== undefined;
  const sessions = await prisma.attendanceSession.findMany({
    where: { recordId: params.id },
    select: { clockIn: true, clockOut: true },
  });
  const hours =
    !timesEdited && sessions.length > 0
      ? summariseSessions(sessions)
      : effectiveIn && effectiveOut
        ? computeHours(effectiveIn, effectiveOut)
        : null;

  // Only checked when the admin is actively setting new times — if they're
  // just resolved-flagged elsewhere (is_compensation, late_exempt) without
  // touching the clock, an already-implausible duration is unaffected by
  // this request either way.
  if (
    timesEdited &&
    hours &&
    isImplausibleDuration(hours.totalHours) &&
    !parsed.data.confirm_long_duration
  ) {
    return failFor(
      ErrorCode.VALIDATION,
      `That's ${hours.totalHours}h — beyond a normal shift (>${MAX_PLAUSIBLE_SHIFT_HOURS}h). Double-check the times, or pass confirm_long_duration=true if this is genuinely correct.`,
    );
  }

  // A hand-set time is Admin/HR's explicit correction — it resolves whatever
  // the EOD cleanup cron flagged (e.g. a suspected reversed device punch), so
  // the flag is cleared rather than left to nag on an already-fixed record.
  const clearsReviewFlag = timesEdited && existing.flaggedForReview;

  const updated = await prisma.attendanceRecord.update({
    where: { id: params.id },
    data: {
      clockInApproved,
      clockOutApproved,
      ...(hours ? { totalHours: hours.totalHours, isHalfDay: hours.isHalfDay } : {}),
      ...(parsed.data.is_compensation !== undefined ? { isCompensation: parsed.data.is_compensation } : {}),
      ...(parsed.data.late_exempt !== undefined ? { lateExempt: parsed.data.late_exempt } : {}),
      ...(parsed.data.late_exempt_reason !== undefined ? { lateExemptReason: parsed.data.late_exempt_reason } : {}),
      ...(clearsReviewFlag ? { flaggedForReview: false, flagReason: null } : {}),
    },
  });

  await audit({
    action: "attendance.edit",
    actorUserId: session!.userId,
    actorRole: session!.role,
    entityType: "attendance_record",
    entityId: params.id,
    metadata: {
      employee_id: existing.employeeId,
      clock_in_before: existing.clockInApproved?.toISOString() ?? null,
      clock_in_after: clockInApproved?.toISOString() ?? null,
      clock_out_before: existing.clockOutApproved?.toISOString() ?? null,
      clock_out_after: clockOutApproved?.toISOString() ?? null,
      ...(parsed.data.is_compensation !== undefined
        ? { is_compensation_before: existing.isCompensation, is_compensation_after: parsed.data.is_compensation }
        : {}),
      ...(parsed.data.late_exempt !== undefined
        ? { late_exempt_before: existing.lateExempt, late_exempt_after: parsed.data.late_exempt }
        : {}),
      ...(clearsReviewFlag ? { review_flag_cleared: true } : {}),
    },
    ip: clientIp(req),
  });

  return ok(updated);
}
