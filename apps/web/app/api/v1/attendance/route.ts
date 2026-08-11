import { Prisma, AttendanceApprovalStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, isLeadRole } from "@/lib/rbac";
import { getLedEmployeeIds } from "@/lib/employees/managed-scope";
import { ok, failFor, ErrorCode } from "@/lib/api/response";

// Track A. GET /api/v1/attendance — Admin/HR see all (optionally filtered to
// one employee), Lead sees their own team, Employee sees only themselves.
// Filters: employee_id, date_from, date_to, approval_status. Scoping is
// server-side and cannot be widened by query params (API_SPEC explicitly
// warns not to rely on frontend filtering).
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return failFor(ErrorCode.UNAUTHENTICATED);
  }

  const { searchParams } = new URL(req.url);
  const employeeIdParam = searchParams.get("employee_id") ?? undefined;
  const dateFrom = searchParams.get("date_from");
  const dateTo = searchParams.get("date_to");
  const approvalStatusParam = searchParams.get("approval_status");

  const where: Prisma.AttendanceRecordWhereInput = {};

  if (dateFrom || dateTo) {
    where.date = {
      ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
      ...(dateTo ? { lte: new Date(dateTo) } : {}),
    };
  }
  if (
    approvalStatusParam &&
    Object.values(AttendanceApprovalStatus).includes(approvalStatusParam as AttendanceApprovalStatus)
  ) {
    where.approvalStatus = approvalStatusParam as AttendanceApprovalStatus;
  }

  if (FINANCE_ROLES.includes(session.role)) {
    if (employeeIdParam) where.employeeId = employeeIdParam;
  } else if (isLeadRole(session.role)) {
    if (!session.employeeId) return ok([]);
    // Scope by the teams this Lead *leads*, not the one team they happen to be
    // a member of. A Lead can own several teams, and the old `viewer.teamId`
    // lookup made every team but their own invisible — they could not see the
    // attendance of people they are directly responsible for.
    const ledIds = await getLedEmployeeIds(session.employeeId);
    if (employeeIdParam && !ledIds.includes(employeeIdParam)) {
      // Silently widening an out-of-scope filter back to "my whole team" used to
      // return other people's records under the employee_id the caller asked
      // for — the screen would then label someone else's attendance as theirs.
      return ok([]);
    }
    where.employeeId = employeeIdParam ?? { in: ledIds };
  } else {
    if (!session.employeeId) return ok([]);
    where.employeeId = session.employeeId;
  }

  const records = await prisma.attendanceRecord.findMany({
    where,
    include: {
      employee: { select: { id: true, fullName: true } },
      // Sessions come along so a client can tell "clocked out for the day" from
      // "on a break" (an open session), and show the day's real worked time
      // rather than last-out minus first-in.
      sessions: {
        select: { id: true, clockIn: true, clockOut: true, workLocation: true },
        orderBy: { clockIn: "asc" },
      },
    },
    orderBy: [{ date: "desc" }],
  });

  return ok(records);
}
