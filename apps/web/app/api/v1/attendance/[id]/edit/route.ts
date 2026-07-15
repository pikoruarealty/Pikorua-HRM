import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { requireRole, AuthzError, FINANCE_ROLES } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { computeHours } from "@/lib/attendance/time";
import { audit, clientIp } from "@/lib/audit";

// Track A. PATCH /api/v1/attendance/:id/edit — Admin/HR. Edits the
// clock_in_approved/clock_out_approved times (e.g. correcting a forgotten
// clock-out), defaulting to the existing approved value (or raw, if never
// edited) when a field is omitted. Raw values are never overwritten — kept
// for audit. total_hours/is_half_day are recomputed from the resulting
// effective (approved-or-raw) times, since that's what payroll will read
// once the record is approved.
const editSchema = z.object({
  clock_in_approved: z.string().datetime().nullable().optional(),
  clock_out_approved: z.string().datetime().nullable().optional(),
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
  const hours = effectiveIn && effectiveOut ? computeHours(effectiveIn, effectiveOut) : null;

  const updated = await prisma.attendanceRecord.update({
    where: { id: params.id },
    data: {
      clockInApproved,
      clockOutApproved,
      ...(hours ? { totalHours: hours.totalHours, isHalfDay: hours.isHalfDay } : {}),
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
    },
    ip: clientIp(req),
  });

  return ok(updated);
}
