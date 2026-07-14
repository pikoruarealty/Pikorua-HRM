import { z } from "zod";
import { AttendanceApprovalStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { isLateArrival } from "@/lib/attendance/time";
import { getApprovedUnpaidLeaveDays } from "@/lib/requests/leave";
import { NotImplementedError } from "@/lib/errors";

// Track A. GET /api/v1/attendance/:employee_id/summary?month=&year=
// (folder is named [id], not [employee_id], only because Next.js requires
// one dynamic-segment name per path level and .../[id]/edit + .../[id]/approve
// use the attendance *record* id at the same level — the URL shape and
// semantics still match API_SPEC.md exactly: this segment is an employee id.)
// Admin/HR (any), Lead (own team only), Employee (self only). Computed from
// **approved-only** attendance records — this is the exact feed payroll
// (Milestone 3) will call.
const querySchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
});

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const employeeId = params.id;
  const session = await getSession();
  if (!session) {
    return failFor(ErrorCode.UNAUTHENTICATED);
  }

  const isFinance = FINANCE_ROLES.includes(session.role);
  const isSelf = session.employeeId === employeeId;
  let isOwnTeamLead = false;
  if (!isFinance && !isSelf && isLeadRole(session.role) && session.employeeId) {
    const [lead, target] = await Promise.all([
      prisma.employee.findUnique({ where: { id: session.employeeId }, select: { teamId: true } }),
      prisma.employee.findUnique({ where: { id: employeeId }, select: { teamId: true } }),
    ]);
    isOwnTeamLead = !!lead?.teamId && lead.teamId === target?.teamId;
  }
  if (!isFinance && !isSelf && !isOwnTeamLead) {
    return failFor(ErrorCode.FORBIDDEN);
  }

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse({
    month: searchParams.get("month"),
    year: searchParams.get("year"),
  });
  if (!parsed.success) {
    return failFor(ErrorCode.VALIDATION, "month (1-12) and year are required query params.");
  }
  const { month, year } = parsed.data;

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, team: { select: { expectedStartTime: true } } },
  });
  if (!employee) {
    return failFor(ErrorCode.NOT_FOUND, "Employee not found.");
  }

  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(year, month, 1)); // exclusive

  const records = await prisma.attendanceRecord.findMany({
    where: {
      employeeId,
      approvalStatus: AttendanceApprovalStatus.approved,
      date: { gte: periodStart, lt: periodEnd },
    },
  });

  const expectedStartTime = employee.team?.expectedStartTime ?? null;
  let lateCount = 0;
  let halfDayCount = 0;
  let lateTrackingUnavailable = false;

  for (const r of records) {
    if (r.isHalfDay) halfDayCount += 1;
    if (!expectedStartTime) {
      lateTrackingUnavailable = true;
      continue;
    }
    // Approved records always have clockInApproved populated by the time
    // they're approved (see PATCH .../approve) — but guard defensively.
    if (r.clockInApproved && isLateArrival(r.clockInApproved, expectedStartTime)) {
      lateCount += 1;
    }
  }

  let unpaidLeaveCount: number | null = null;
  let unpaidLeaveUnavailable = false;
  try {
    unpaidLeaveCount = await getApprovedUnpaidLeaveDays(employeeId, month, year);
  } catch (err) {
    if (err instanceof NotImplementedError) {
      unpaidLeaveUnavailable = true;
    } else {
      throw err;
    }
  }

  return ok({
    employee_id: employeeId,
    month,
    year,
    late_count: lateCount,
    half_day_count: halfDayCount,
    unpaid_leave_count: unpaidLeaveCount,
    approved_record_count: records.length,
    notes: {
      late_tracking_unavailable: lateTrackingUnavailable
        ? "This employee's team has no expected_start_time configured — late count excludes those days."
        : undefined,
      unpaid_leave_unavailable: unpaidLeaveUnavailable
        ? "Track B has not implemented getApprovedUnpaidLeaveDays yet."
        : undefined,
    },
  });
}
