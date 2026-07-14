import { Prisma, AttendanceApprovalStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, isLeadRole } from "@/lib/rbac";
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
    const lead = await prisma.employee.findUnique({
      where: { id: session.employeeId },
      select: { teamId: true },
    });
    if (!lead?.teamId) return ok([]);
    const teammates = await prisma.employee.findMany({
      where: { teamId: lead.teamId },
      select: { id: true },
    });
    const teammateIds = teammates.map((t) => t.id);
    where.employeeId = employeeIdParam && teammateIds.includes(employeeIdParam)
      ? employeeIdParam
      : { in: teammateIds };
  } else {
    if (!session.employeeId) return ok([]);
    where.employeeId = session.employeeId;
  }

  const records = await prisma.attendanceRecord.findMany({
    where,
    include: { employee: { select: { id: true, fullName: true } } },
    orderBy: [{ date: "desc" }],
  });

  return ok(records);
}
