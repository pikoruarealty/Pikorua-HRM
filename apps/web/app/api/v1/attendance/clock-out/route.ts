import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { todayDateOnly, computeHours } from "@/lib/attendance/time";

// Track A. POST /api/v1/attendance/clock-out — server-timestamped. Computes
// a preliminary total_hours/is_half_day from the raw times immediately (best
// available figures for the review UI); these get recomputed from the
// *approved* times on edit/approve, since payroll only ever counts approved
// records (see PATCH .../edit and .../approve).
export async function POST() {
  const session = await getSession();
  if (!session) {
    return failFor(ErrorCode.UNAUTHENTICATED);
  }
  if (!session.employeeId) {
    return failFor(ErrorCode.FORBIDDEN, "No employee record linked to this account.");
  }

  const date = todayDateOnly();
  const now = new Date();

  const existing = await prisma.attendanceRecord.findUnique({
    where: { employeeId_date: { employeeId: session.employeeId, date } },
  });

  if (!existing?.clockInRaw) {
    return fail(ErrorCode.CONFLICT, "Must clock in before clocking out.", 409);
  }
  if (existing.clockOutRaw) {
    return fail(ErrorCode.CONFLICT, "Already clocked out today.", 409);
  }

  const { totalHours, isHalfDay } = computeHours(existing.clockInRaw, now);

  const record = await prisma.attendanceRecord.update({
    where: { id: existing.id },
    data: { clockOutRaw: now, totalHours, isHalfDay },
  });

  return ok(record);
}
