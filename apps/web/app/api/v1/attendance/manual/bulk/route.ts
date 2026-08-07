import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { computeHours } from "@/lib/attendance/time";
import { AttendanceApprovalStatus, AttendanceSource } from "@prisma/client";
import { audit, clientIp } from "@/lib/audit";

// Manual override (2026-08-07, widened to Admin/HR same day). POST
// /api/v1/attendance/manual/bulk — **Admin/HR**: the multi-employee x
// multi-date sibling of /attendance/manual — same per-record
// create-or-overwrite semantics (record written pre-approved, the person
// entering it by hand IS the approval), just looped. Returns per-record
// success/failure so one bad employee_id doesn't silently drop the rest of
// a large batch. One summary audit entry covers the whole batch rather than
// one per row.

const MAX_RECORDS = 500;

const recordSchema = z.object({
  employee_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  clock_in: z.string().datetime(),
  clock_out: z.string().datetime().optional(),
});

const bulkSchema = z.object({
  reason: z.string().min(3, "A reason is required for a manual record."),
  records: z.array(recordSchema).min(1).max(MAX_RECORDS),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!FINANCE_ROLES.includes(session.role)) return failFor(ErrorCode.FORBIDDEN);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
  }
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) {
    return failFor(ErrorCode.VALIDATION, parsed.error.issues[0]?.message ?? "Invalid bulk request.");
  }
  const { reason, records } = parsed.data;

  const employeeIds = [...new Set(records.map((r) => r.employee_id))];
  const employees = await prisma.employee.findMany({
    where: { id: { in: employeeIds } },
    select: { id: true },
  });
  const validEmployeeIds = new Set(employees.map((e) => e.id));

  type ResultRow = {
    employee_id: string;
    date: string;
    ok: boolean;
    error?: string;
    id?: string;
  };
  const results: ResultRow[] = [];
  let created = 0;
  let updated = 0;

  for (const r of records) {
    if (!validEmployeeIds.has(r.employee_id)) {
      results.push({ employee_id: r.employee_id, date: r.date, ok: false, error: "employee_id does not reference an existing employee." });
      continue;
    }

    const date = new Date(`${r.date}T00:00:00.000Z`);
    const clockIn = new Date(r.clock_in);
    const clockOut = r.clock_out ? new Date(r.clock_out) : null;
    if (clockOut && clockOut <= clockIn) {
      results.push({ employee_id: r.employee_id, date: r.date, ok: false, error: "clock_out must be after clock_in." });
      continue;
    }

    const hours = clockOut ? computeHours(clockIn, clockOut) : null;
    const existing = await prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId: r.employee_id, date } },
    });

    const data = {
      clockInApproved: clockIn,
      clockOutApproved: clockOut,
      ...(hours ? { totalHours: hours.totalHours, isHalfDay: hours.isHalfDay } : {}),
      approvalStatus: AttendanceApprovalStatus.approved,
      approvedById: session.userId,
      approvedAt: new Date(),
      source: AttendanceSource.manual,
    };

    try {
      const record = existing
        ? await prisma.attendanceRecord.update({ where: { id: existing.id }, data })
        : await prisma.attendanceRecord.create({ data: { employeeId: r.employee_id, date, ...data } });
      if (existing) updated++;
      else created++;
      results.push({ employee_id: r.employee_id, date: r.date, ok: true, id: record.id });
    } catch {
      results.push({ employee_id: r.employee_id, date: r.date, ok: false, error: "Failed to write attendance record." });
    }
  }

  const dates = records.map((r) => r.date).sort();

  await audit({
    action: "attendance.manual_bulk",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "attendance_record",
    metadata: {
      reason,
      total: records.length,
      created,
      updated,
      failed: results.filter((r) => !r.ok).length,
      employee_ids: employeeIds,
      date_range: { from: dates[0], to: dates[dates.length - 1] },
    },
    ip: clientIp(req),
  });

  return ok({ results, created, updated, failed: results.filter((r) => !r.ok).length });
}
