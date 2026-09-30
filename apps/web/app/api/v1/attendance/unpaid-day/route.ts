import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { todayDateOnly } from "@/lib/attendance/time";
import { dateKey } from "@/lib/attendance/week";
import { getWeekOff } from "@/lib/attendance/weekly-off";
import { syncCompensationCreditsForWeek } from "@/lib/attendance/compensation-credits";
import { ATTENDANCE_EXEMPT_MESSAGE, isAttendanceExemptRole } from "@/lib/attendance/tracking";
import { audit, clientIp } from "@/lib/audit";

// POST/DELETE /api/v1/attendance/unpaid-day (2026-09-30, owner request) — the
// employee's own switch for a day that was automatically marked as their weekly
// off (lib/attendance/weekly-off.ts): turn it into unpaid leave, or turn it
// back. "From their side": no approval, because it can only make the day cost
// them pay, never the company. The point is that an automatic off uses up the
// week's off — switching it to unpaid frees that off to be taken on another day
// (POST /attendance/weekly-off) or banked as a compensation credit.
//
// Only a day that is *currently* an automatic weekly off can be switched, and
// nothing can change once the month has a payslip — that would alter a number
// that has already been calculated.

const bodySchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD") }).strict();

async function readDate(req: Request): Promise<{ date: Date } | { error: Response }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { error: failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.") };
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return { error: failFor(ErrorCode.VALIDATION, parsed.error.issues[0]?.message ?? "Invalid body.") };
  }
  const date = new Date(`${parsed.data.date}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return { error: failFor(ErrorCode.VALIDATION, "Not a valid date.") };
  return { date };
}

async function guard(employeeId: string, role: string, date: Date): Promise<Response | null> {
  if (isAttendanceExemptRole(role)) return failFor(ErrorCode.FORBIDDEN, ATTENDANCE_EXEMPT_MESSAGE);
  const payslip = await prisma.payslip.findUnique({
    where: {
      employeeId_periodYear_periodMonth: {
        employeeId,
        periodYear: date.getUTCFullYear(),
        periodMonth: date.getUTCMonth() + 1,
      },
    },
    select: { id: true },
  });
  if (payslip) {
    return fail(ErrorCode.CONFLICT, "That month already has a payslip, so this day can't be changed.", 409);
  }
  return null;
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!session.employeeId) return failFor(ErrorCode.FORBIDDEN, "No employee record linked to this account.");
  const read = await readDate(req);
  if ("error" in read) return read.error;
  const { date } = read;

  const blocked = await guard(session.employeeId, session.role, date);
  if (blocked) return blocked;

  if (date.getTime() > todayDateOnly().getTime()) {
    return fail(ErrorCode.VALIDATION, "Only a day that has already happened can be switched.", 422);
  }
  const weekOff = await getWeekOff(session.employeeId, date);
  if (!weekOff || weekOff.kind !== "auto" || weekOff.date !== dateKey(date)) {
    return fail(ErrorCode.VALIDATION, "That day isn't an automatic weekly off.", 422);
  }

  const declaration = await prisma.unpaidDayDeclaration.upsert({
    where: { employeeId_date: { employeeId: session.employeeId, date } },
    create: { employeeId: session.employeeId, date },
    update: {},
  });
  await syncCompensationCreditsForWeek(session.employeeId, date).catch(() => {});

  await audit({
    action: "attendance.unpaid_day_declare",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "unpaid_day_declaration",
    entityId: declaration.id,
    metadata: { employee_id: session.employeeId, date: dateKey(date) },
    ip: clientIp(req),
  });
  return ok({ date: dateKey(date) }, 201);
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!session.employeeId) return failFor(ErrorCode.FORBIDDEN, "No employee record linked to this account.");
  const read = await readDate(req);
  if ("error" in read) return read.error;
  const { date } = read;

  const blocked = await guard(session.employeeId, session.role, date);
  if (blocked) return blocked;

  const existing = await prisma.unpaidDayDeclaration.findUnique({
    where: { employeeId_date: { employeeId: session.employeeId, date } },
  });
  if (!existing) return failFor(ErrorCode.NOT_FOUND, "That day wasn't switched to unpaid.");

  await prisma.unpaidDayDeclaration.delete({ where: { id: existing.id } });
  await syncCompensationCreditsForWeek(session.employeeId, date).catch(() => {});

  await audit({
    action: "attendance.unpaid_day_revert",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "unpaid_day_declaration",
    entityId: existing.id,
    metadata: { employee_id: session.employeeId, date: dateKey(date) },
    ip: clientIp(req),
  });
  return ok({ date: dateKey(date) });
}
