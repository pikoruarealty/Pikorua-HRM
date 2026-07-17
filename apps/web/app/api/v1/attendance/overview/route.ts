import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, requireRole, AuthzError } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { isLateArrival, todayDateOnly } from "@/lib/attendance/time";
import { getLatestPayrollConfig } from "@/lib/payroll/config";
import { EmployeeStatus, RequestStatus, RequestType } from "@prisma/client";

// Track A (2026-07-15). GET /api/v1/attendance/overview?date=YYYY-MM-DD —
// Admin/HR only. The "glance" view of a single day: present / half-day /
// on-leave / absent counts plus a per-employee status row, so Admin can see
// everything attendance-related for the whole company at once.
//
// Status resolution per active employee, in order:
//   attendance row (clock-in) → present (half_day if flagged, late if the
//   team's expected start time was missed) → else approved leave covering
//   the date → on_leave (paid/unpaid) → else holiday → absent.

type EmployeeDayStatus = "present" | "half_day" | "on_leave" | "absent" | "holiday";

export async function GET(req: Request) {
  const session = await getSession();
  try {
    requireRole(session, FINANCE_ROLES);
  } catch (err) {
    if (err instanceof AuthzError) return failFor(err.kind);
    throw err;
  }

  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date");
  if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return failFor(ErrorCode.VALIDATION, "date must be YYYY-MM-DD.");
  }
  const date = dateParam ? new Date(`${dateParam}T00:00:00.000Z`) : todayDateOnly();
  if (Number.isNaN(date.getTime())) {
    return failFor(ErrorCode.VALIDATION, "date is not a valid calendar date.");
  }

  const [employees, records, leaves, holiday] = await Promise.all([
    prisma.employee.findMany({
      where: { status: EmployeeStatus.active },
      select: {
        id: true,
        fullName: true,
        photoUrl: true,
        team: { select: { id: true, name: true, expectedStartTime: true } },
        department: { select: { id: true, name: true } },
      },
      orderBy: { fullName: "asc" },
    }),
    prisma.attendanceRecord.findMany({ where: { date } }),
    prisma.request.findMany({
      where: {
        type: { in: [RequestType.leave_paid, RequestType.leave_unpaid] },
        status: RequestStatus.approved,
        dateFrom: { lte: date },
        dateTo: { gte: date },
      },
      select: { employeeId: true, type: true },
    }),
    prisma.holiday.findUnique({ where: { date } }),
  ]);

  // Today's live view uses the current (latest) late-grace policy.
  const lateGraceMinutes = (await getLatestPayrollConfig())?.lateGraceMinutes ?? 0;

  const recordByEmployee = new Map(records.map((r) => [r.employeeId, r]));
  const leaveByEmployee = new Map(leaves.map((l) => [l.employeeId, l.type]));

  const rows = employees.map((e) => {
    const record = recordByEmployee.get(e.id);
    const leaveType = leaveByEmployee.get(e.id);

    let status: EmployeeDayStatus;
    let late = false;
    if (record?.clockInRaw) {
      status = record.isHalfDay ? "half_day" : "present";
      const effectiveClockIn = record.clockInApproved ?? record.clockInRaw;
      late = isLateArrival(effectiveClockIn, e.team?.expectedStartTime ?? null, lateGraceMinutes);
    } else if (leaveType) {
      status = "on_leave";
    } else if (holiday) {
      status = "holiday";
    } else {
      status = "absent";
    }

    return {
      employeeId: e.id,
      fullName: e.fullName,
      photoUrl: e.photoUrl ? `/api/v1/employees/${e.id}/photo` : null,
      team: e.team ? { id: e.team.id, name: e.team.name } : null,
      department: e.department,
      status,
      late,
      leaveType: leaveType ?? null,
      clockIn: record?.clockInApproved ?? record?.clockInRaw ?? null,
      clockOut: record?.clockOutApproved ?? record?.clockOutRaw ?? null,
      totalHours: record?.totalHours ?? null,
      approvalStatus: record?.approvalStatus ?? null,
    };
  });

  const counts = {
    total: rows.length,
    present: rows.filter((r) => r.status === "present").length,
    halfDay: rows.filter((r) => r.status === "half_day").length,
    onLeave: rows.filter((r) => r.status === "on_leave").length,
    absent: rows.filter((r) => r.status === "absent").length,
    late: rows.filter((r) => r.late).length,
    pendingApproval: records.filter((r) => r.approvalStatus === "pending").length,
  };

  return ok({
    date: date.toISOString().slice(0, 10),
    holiday: holiday ? { id: holiday.id, name: holiday.name } : null,
    counts,
    rows,
  });
}
