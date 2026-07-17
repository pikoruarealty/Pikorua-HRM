import { z } from "zod";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, requireRole, AuthzError } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { getMonthlyAttendanceBreakdownForAllEmployees } from "@/lib/attendance/monthly-breakdown";

// Track A (2026-07-17). GET /api/v1/attendance/monthly-overview?month=&year=
// — Admin/HR only. Company-wide monthly present/absent/leave/compensation
// counts, complementing the existing daily attendance/overview.

const querySchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
});

export async function GET(req: Request) {
  const session = await getSession();
  try {
    requireRole(session, FINANCE_ROLES);
  } catch (err) {
    if (err instanceof AuthzError) return failFor(err.kind);
    throw err;
  }

  const { searchParams } = new URL(req.url);
  const now = new Date();
  const parsed = querySchema.safeParse({
    month: searchParams.get("month") ?? now.getMonth() + 1,
    year: searchParams.get("year") ?? now.getFullYear(),
  });
  if (!parsed.success) {
    return failFor(ErrorCode.VALIDATION, "month (1-12) and year are required query params.");
  }
  const { month, year } = parsed.data;

  const rows = await getMonthlyAttendanceBreakdownForAllEmployees(month, year);

  const totals = rows.reduce(
    (acc, r) => {
      acc.presentDays += r.presentDays;
      acc.halfDays += r.halfDays;
      acc.holidayDays = Math.max(acc.holidayDays, r.holidayDays);
      acc.paidLeaveDays += r.paidLeaveDays;
      acc.unpaidLeaveDays += r.unpaidLeaveDays;
      acc.absentDays += r.absentDays;
      acc.compensationDays += r.compensationDays;
      return acc;
    },
    {
      presentDays: 0,
      halfDays: 0,
      holidayDays: 0,
      paidLeaveDays: 0,
      unpaidLeaveDays: 0,
      absentDays: 0,
      compensationDays: 0,
    },
  );

  return ok({ month, year, totals, rows });
}
