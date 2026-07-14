import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { todayDateOnly } from "@/lib/attendance/time";

// Track A. POST /api/v1/attendance/clock-in — any authenticated user with a
// linked employee record clocks themselves in (attendance applies org-wide,
// not just "employee"-role individual contributors — Leads/Admin/HR are
// employees too). Server-timestamped; never trust a client-supplied time.
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

  if (existing?.clockInRaw) {
    return fail(ErrorCode.CONFLICT, "Already clocked in today.", 409);
  }

  const record = existing
    ? await prisma.attendanceRecord.update({
        where: { id: existing.id },
        data: { clockInRaw: now },
      })
    : await prisma.attendanceRecord.create({
        data: { employeeId: session.employeeId, date, clockInRaw: now },
      });

  return ok(record, 201);
}
