import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { Role } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { pushNotification } from "@/lib/notifications/push";
import { RequestStatus, RequestType } from "@prisma/client";
import { audit, clientIp } from "@/lib/audit";
import { ATTENDANCE_EXEMPT_MESSAGE, isAttendanceExemptRole } from "@/lib/attendance/tracking";
import { getMonthlyAttendanceBreakdown } from "@/lib/attendance/monthly-breakdown";
import { syncCompensationCreditsForRange } from "@/lib/attendance/compensation-credits";
import { getApprovedPaidLeaveDays } from "@/lib/requests/leave";
import { getEffectivePaidLeaveCaps } from "@/lib/leave/balance";
import {
  HALF_DAY_WEIGHT,
  partsToSegments,
  planLeaveParts,
  type LeaveDayType,
} from "@/lib/requests/leave-math";

// Admin manual override (2026-10-04, owner request). POST
// /api/v1/attendance/mark-paid-leave — **Admin only** (same tier as
// request.override; deliberately not widened to HR): turn a day the walk counts
// as ABSENT or as UNPAID LEAVE into paid leave for one employee.
//
// What it writes (nothing is invented outside the leave tables):
//  - an approved leave_unpaid request covering the date is rewritten so that
//    date becomes paid (the row is split around it, exactly like the approve
//    route's manual day split) — same weight as the unpaid day it replaces;
//  - whatever part of the day is still uncovered (a plain absence, a switched
//    weekly off, the other half of a half-day) gets a new, already-approved
//    paid-leave row.
// So after the call the day is paid leave in full, and every consumer — tiles,
// calendar, payable days, balance — reads it through the ordinary leave rows.
//
// It is an explicit Admin grant, so it is NOT held to the monthly/yearly paid
// allowance (the usual auto-overflow would just turn it straight back into
// unpaid); the response says when it pushes the employee over their cap. Refused
// once the month has a payslip — that would change a number already calculated.
// Reason is mandatory and the call is audited.

const bodySchema = z.object({
  employee_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  type: z.enum([RequestType.leave_casual, RequestType.leave_sick]).optional(),
  // Only meaningful for a plain absent day (an unpaid-leave day keeps its own
  // weight). Omitted = a whole day.
  half_day: z.boolean().optional(),
  reason: z.string().trim().min(3, "A reason is required."),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (session.role !== Role.admin) return failFor(ErrorCode.FORBIDDEN);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return failFor(ErrorCode.VALIDATION, parsed.error.issues[0]?.message ?? "Invalid request.");
  }
  const d = parsed.data;
  const paidType = d.type ?? RequestType.leave_casual;
  const date = new Date(`${d.date}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return failFor(ErrorCode.VALIDATION, "Not a valid date.");
  const month = date.getUTCMonth() + 1;
  const year = date.getUTCFullYear();

  const employee = await prisma.employee.findUnique({ where: { id: d.employee_id } });
  if (!employee) return failFor(ErrorCode.VALIDATION, "employee_id does not reference an existing employee.");
  if (isAttendanceExemptRole(employee.role)) {
    return failFor(ErrorCode.VALIDATION, ATTENDANCE_EXEMPT_MESSAGE);
  }

  const payslip = await prisma.payslip.findUnique({
    where: { employeeId_periodYear_periodMonth: { employeeId: d.employee_id, periodYear: year, periodMonth: month } },
    select: { id: true },
  });
  if (payslip) {
    return fail(
      ErrorCode.CONFLICT,
      "That month already has a payslip, so this day can't be changed. Unfinalize or delete the draft payslip first.",
      409,
    );
  }

  // Judge the day by the same walk that produces the tiles and the calendar, so
  // this can only ever act on a day the pay numbers really show as unpaid/absent.
  const breakdown = await getMonthlyAttendanceBreakdown(d.employee_id, month, year);
  const day = breakdown.days.find((x) => x.date === d.date);
  if (!day) {
    return fail(ErrorCode.VALIDATION, "That day hasn't been counted yet (it is in the future or before joining).", 422);
  }
  if (day.status !== "absent" && day.status !== "unpaid_leave") {
    return fail(
      ErrorCode.VALIDATION,
      `That day is counted as "${day.status.replace(/_/g, " ")}", not absent or unpaid leave, so there is nothing to change.`,
      422,
    );
  }

  const unpaidWeight = day.leaveUnpaid ?? 0;
  const absentWeight = day.status === "absent" ? 1 : (day.absentPart ?? 0);
  if (d.half_day && day.status !== "absent") {
    return failFor(ErrorCode.VALIDATION, "half_day only applies to a plain absent day.");
  }

  // Approved unpaid rows that cover this date (normally one; more only if two
  // requests overlap, which the walk already caps at one day).
  const unpaidRows = await prisma.request.findMany({
    where: {
      employeeId: d.employee_id,
      type: RequestType.leave_unpaid,
      status: RequestStatus.approved,
      dateFrom: { lte: date },
      dateTo: { gte: date },
    },
    orderBy: { dateFrom: "asc" },
  });

  const now = new Date();
  const note = `Marked as paid leave by Admin: ${d.reason}`;
  const createdIds: string[] = [];
  const convertedIds: string[] = [];
  let converted = 0;

  await prisma.$transaction(async (tx) => {
    for (const row of unpaidRows) {
      if (!row.dateFrom || !row.dateTo) continue;
      const segments = partsToSegments(
        planLeaveParts({
          dateFrom: row.dateFrom,
          dateTo: row.dateTo,
          baseType: RequestType.leave_unpaid as LeaveDayType,
          baseHalf: row.halfDay,
          typeOverrides: new Map<string, LeaveDayType>([[d.date, paidType as LeaveDayType]]),
        }),
      );
      const [head, ...rest] = segments;
      if (!head) continue;
      const touchesHead = head.type !== RequestType.leave_unpaid;
      await tx.request.update({
        where: { id: row.id },
        data: {
          type: head.type as RequestType,
          dateFrom: head.dateFrom,
          dateTo: head.dateTo,
          halfDay: head.halfDay === true,
          ...(touchesHead ? { approverId: session.userId, approvedAt: now } : {}),
        },
      });
      convertedIds.push(row.id);
      for (const seg of rest) {
        const isPaidSeg = seg.type !== RequestType.leave_unpaid;
        const made = await tx.request.create({
          data: {
            employeeId: d.employee_id,
            type: seg.type as RequestType,
            dateFrom: seg.dateFrom,
            dateTo: seg.dateTo,
            halfDay: seg.halfDay === true,
            description: isPaidSeg ? note : row.description,
            status: RequestStatus.approved,
            approverId: isPaidSeg ? session.userId : row.approverId,
            approvedAt: isPaidSeg ? now : row.approvedAt,
          },
        });
        createdIds.push(made.id);
      }
      // What this row contributed to the day, whole or half.
      converted += row.halfDay ? HALF_DAY_WEIGHT : 1;
    }

    // The part of the day nothing paid covers yet: the whole day for an absence
    // or a switched weekly off (unpaid with no request row), the other half for a
    // half-day unpaid leave / a half-day request.
    const alreadyConverted = Math.min(unpaidWeight, converted);
    const toCreate = d.half_day ? HALF_DAY_WEIGHT : unpaidWeight - alreadyConverted + absentWeight;
    if (toCreate > 0) {
      const made = await tx.request.create({
        data: {
          employeeId: d.employee_id,
          type: paidType,
          dateFrom: date,
          dateTo: date,
          halfDay: toCreate <= HALF_DAY_WEIGHT,
          description: note,
          status: RequestStatus.approved,
          approverId: session.userId,
          approvedAt: now,
        },
      });
      createdIds.push(made.id);
    }
  });

  const requester = await prisma.user.findUnique({ where: { employeeId: d.employee_id } });
  if (requester) {
    await pushNotification(
      requester.id,
      "leave_marked_paid",
      `An admin marked ${d.date} as paid leave for you (${day.status === "absent" ? "was absent" : "was unpaid leave"}).`,
    );
  }

  await audit({
    action: "attendance.mark_paid_leave",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "request",
    entityId: convertedIds[0] ?? createdIds[0],
    metadata: {
      employee_id: d.employee_id,
      date: d.date,
      day_status_before: day.status,
      leave_type: paidType,
      half_day: d.half_day === true,
      converted_request_ids: convertedIds,
      created_request_ids: createdIds,
      reason: d.reason,
    },
    ip: clientIp(req),
  });

  // Leave going in or out of force moves the week's weekly off / credit
  // redemption — same hook the approve and override routes run.
  await syncCompensationCreditsForRange(d.employee_id, date, date).catch(() => {});

  // Informational only: the grant above deliberately ignores the allowance.
  const [{ monthlyCap }, usedMonth] = await Promise.all([
    getEffectivePaidLeaveCaps(d.employee_id, month, year),
    getApprovedPaidLeaveDays(d.employee_id, month, year),
  ]);

  return ok({
    date: d.date,
    leave_type: paidType,
    converted_request_ids: convertedIds,
    created_request_ids: createdIds,
    monthly_paid_leave_used: usedMonth,
    monthly_paid_leave_cap: monthlyCap,
    exceeds_monthly_cap: usedMonth > monthlyCap,
  });
}
