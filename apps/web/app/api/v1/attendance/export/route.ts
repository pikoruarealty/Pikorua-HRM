import { z } from "zod";
import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { failFor, ErrorCode } from "@/lib/api/response";
import { isUuid } from "@/lib/api/params";
import { audit, clientIp } from "@/lib/audit";
import { buildAttendanceReport, loadReportEmployeeIds } from "@/lib/attendance/report";
import { AttendanceReportDocument } from "@/lib/attendance/attendance-pdf";

// GET /api/v1/attendance/export?month=&year=&employee_ids=a,b,c — Admin only
// (2026-10-01, owner request). A PDF of the month's attendance for the selected
// employees (omit `employee_ids` for everyone tracked), one page per employee: their
// details, the month's totals and every day, from the same walk the attendance page
// and payroll use. Admin accounts have no attendance (lib/attendance/tracking.ts) and
// are never included; inactive employees aren't offered.
const MAX_EMPLOYEES = 200;

const querySchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
});

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!isAdmin(session.role)) return failFor(ErrorCode.FORBIDDEN, "Downloading attendance is an Admin-only action.");

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse({ month: searchParams.get("month"), year: searchParams.get("year") });
  if (!parsed.success) return failFor(ErrorCode.VALIDATION, "month (1-12) and year are required query params.");
  const { month, year } = parsed.data;

  const rawIds = searchParams.get("employee_ids");
  let requested: string[] | null = null;
  if (rawIds !== null && rawIds.trim() !== "") {
    requested = [...new Set(rawIds.split(",").map((s) => s.trim()).filter(Boolean))];
    if (requested.some((id) => !isUuid(id))) {
      return failFor(ErrorCode.VALIDATION, "employee_ids must be a comma-separated list of employee ids.");
    }
    if (requested.length > MAX_EMPLOYEES) {
      return failFor(ErrorCode.VALIDATION, `Select at most ${MAX_EMPLOYEES} employees per download.`);
    }
  }

  const employeeIds = await loadReportEmployeeIds(requested);
  if (employeeIds.length === 0) {
    return failFor(ErrorCode.VALIDATION, "No tracked employees to export — Admin accounts have no attendance.");
  }

  const employees = await buildAttendanceReport(employeeIds, month, year);
  const generator = session.employeeId
    ? await prisma.employee.findUnique({ where: { id: session.employeeId }, select: { fullName: true } })
    : null;

  const buffer = await renderToBuffer(
    AttendanceReportDocument({
      month,
      year,
      generatedAt: new Date().toISOString(),
      generatedBy: generator?.fullName ?? null,
      employees,
    }),
  );

  await audit({
    action: "attendance.export_pdf",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "attendance",
    entityId: `${year}-${String(month).padStart(2, "0")}`,
    metadata: {
      period: `${year}-${String(month).padStart(2, "0")}`,
      employee_count: employees.length,
      all_employees: requested === null,
    },
    ip: clientIp(req),
  });

  const period = `${year}-${String(month).padStart(2, "0")}`;
  const only = employees.length === 1 ? employees[0]!.employee.fullName : null;
  const slug = only
    ? `-${only
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")}`
    : "";
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="attendance${slug}-${period}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
