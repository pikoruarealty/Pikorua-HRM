import { syncCompensationCreditsForRange } from "@/lib/attendance/compensation-credits";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, Role, requireRole, AuthzError } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { pushNotification } from "@/lib/notifications/push";
import { RequestStatus, RequestType } from "@prisma/client";
import { audit, clientIp } from "@/lib/audit";
import {
  planLeaveParts,
  partsToSegments,
  isPaidLeaveType,
  type LeaveCaps,
  type LeaveDayType,
} from "@/lib/requests/leave-math";
import { getApprovedPaidLeaveDaysByMonthsInRange, getApprovedPaidLeaveDaysForYear } from "@/lib/requests/leave";
import { getEffectivePaidLeaveCaps } from "@/lib/leave/balance";

// Track B. PATCH /api/v1/requests/:id/approve — Milestone 1.3.
// Golden rule: Admin/HR only, always — Team Leads get 403 even for their own team.
//
// Partial leave approval (owner request, 2026-09-01): a multi-day leave
// request is submitted as a single paid-or-unpaid type, but Admin/HR may want
// to pay out only *some* of those days (e.g. the employee only had 2 paid
// days left of a 5-day request). `day_overrides` lets the approver flip
// individual dates within the request's own range to the other leave type;
// every other day keeps the request's original type. The request is then
// materialized as one Request row per contiguous run of the same type (see
// splitLeaveRangeByOverrides) — the first run reuses this row, any further
// runs become new, already-approved rows — so downstream payroll (which
// reads `type` + `dateFrom`/`dateTo` per row, see
// lib/attendance/monthly-breakdown.ts) pays/deducts each day correctly with
// no extra plumbing.
// Monthly/annual cap auto-overflow (2026-09-06, owner request): approving a
// leave_casual/leave_sick request with no day_overrides now automatically
// converts only the days beyond the employee's monthly/yearly paid-leave cap
// to leave_unpaid (see allocateLeaveDaysAgainstCaps) — this is on by default,
// not opt-in. Admin (not HR) can bypass this entirely for one approval via
// override_monthly_cap + a reason, e.g. a genuine one-off exception; that
// path is audited distinctly (admin_override: true) and does NOT touch the
// day_overrides / manual-split path above, which still wins whenever supplied.
//
// Half-day leave (owner request, 2026-10-01): a request can itself be a half day
// (Request.halfDay), and the approver can approve any day of a full-day request as
// a half day via `half_day_dates`. Half-days feed the same planner as the caps and
// the manual split (lib/requests/leave-math.ts planLeaveParts), so a half day that
// no longer fits the paid allowance — or a full day with only half an allowance
// left — is handled by the same rule rather than a second code path.
const approveSchema = z
  .object({
    day_overrides: z
      .array(
        z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
          type: z.nativeEnum(RequestType),
        }),
      )
      .optional(),
    half_day_dates: z
      .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"))
      .optional(),
    override_monthly_cap: z.boolean().optional(),
    reason: z.string().min(3, "A reason is required to override the monthly cap.").optional(),
  })
  .refine((v) => !v.override_monthly_cap || (v.reason && v.reason.length >= 3), {
    message: "A reason is required to override the monthly cap.",
    path: ["reason"],
  })
  .optional();

const LEAVE_TYPES: RequestType[] = [RequestType.leave_casual, RequestType.leave_sick, RequestType.leave_unpaid];

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  try {
    requireRole(session, FINANCE_ROLES);
  } catch (err) {
    if (err instanceof AuthzError) return failFor(err.kind);
    throw err;
  }

  let body: unknown = undefined;
  const rawText = await req.text();
  if (rawText) {
    try {
      body = JSON.parse(rawText);
    } catch {
      return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
    }
  }
  const parsedBody = approveSchema.safeParse(body);
  if (!parsedBody.success) {
    return failFor(ErrorCode.VALIDATION, parsedBody.error.issues[0]?.message ?? "Invalid approval body.");
  }
  const dayOverrides = parsedBody.data?.day_overrides ?? [];
  const halfDayDates = [...new Set(parsedBody.data?.half_day_dates ?? [])];
  const overrideMonthlyCap = parsedBody.data?.override_monthly_cap ?? false;
  const overrideReason = parsedBody.data?.reason;

  if (overrideMonthlyCap && session!.role !== Role.admin) {
    return failFor(ErrorCode.FORBIDDEN, "Only Admin can override the monthly leave cap.");
  }

  const request = await prisma.request.findUnique({ where: { id: params.id } });
  if (!request) return failFor(ErrorCode.NOT_FOUND);
  if (request.status !== RequestStatus.pending) {
    return failFor(ErrorCode.CONFLICT, "Only pending requests can be approved.");
  }

  // Hierarchy rule: HR can approve Employees'/Leads' requests, but not their
  // own — an HR request must go up to Admin. Self-approval is blocked for
  // every role including Admin (2026-09-01: Admin can now file its own
  // request too) — a second Admin/HR account must action it instead.
  const requester = await prisma.user.findUnique({ where: { employeeId: request.employeeId } });
  if (requester && requester.id === session!.userId) {
    return failFor(ErrorCode.FORBIDDEN, "Cannot approve your own request.");
  }

  const isLeaveRequest = LEAVE_TYPES.includes(request.type) && !!request.dateFrom && !!request.dateTo;
  if (dayOverrides.length > 0 || halfDayDates.length > 0) {
    if (!isLeaveRequest) {
      return failFor(ErrorCode.VALIDATION, "day_overrides and half_day_dates only apply to leave requests.");
    }
    for (const o of dayOverrides) {
      if (!LEAVE_TYPES.includes(o.type)) {
        return failFor(ErrorCode.VALIDATION, "day_overrides type must be leave_casual, leave_sick, or leave_unpaid.");
      }
    }
    for (const date of [...dayOverrides.map((o) => o.date), ...halfDayDates]) {
      const d = new Date(`${date}T00:00:00.000Z`);
      if (d < request.dateFrom! || d > request.dateTo!) {
        return failFor(ErrorCode.VALIDATION, `${date} is outside this request's date range.`);
      }
    }
  }

  const now = new Date();
  let updated;
  const createdIds: string[] = [];
  let autoCapped = false;

  // Auto-overflow: only kicks in for a paid-leave request approved WITHOUT a
  // manual day_overrides split, and only when Admin hasn't explicitly
  // overridden the cap for this approval.
  let caps: LeaveCaps | null = null;
  if (isLeaveRequest && dayOverrides.length === 0 && !overrideMonthlyCap && isPaidLeaveType(request.type)) {
    const dateFrom = request.dateFrom!;
    const dateTo = request.dateTo!;
    const [{ monthlyCap, yearlyCap }, approvedPaidByMonthKey, approvedPaidThisYear] = await Promise.all([
      getEffectivePaidLeaveCaps(request.employeeId, dateFrom.getUTCMonth() + 1, dateFrom.getUTCFullYear()),
      getApprovedPaidLeaveDaysByMonthsInRange(request.employeeId, dateFrom, dateTo),
      getApprovedPaidLeaveDaysForYear(request.employeeId, dateFrom.getUTCFullYear()),
    ]);
    caps = { approvedPaidByMonthKey, approvedPaidThisYear, monthlyCap, yearlyCap };
  }

  const segments = isLeaveRequest
    ? partsToSegments(
        planLeaveParts({
          dateFrom: request.dateFrom!,
          dateTo: request.dateTo!,
          baseType: request.type as LeaveDayType,
          baseHalf: request.halfDay,
          halfDates: new Set(halfDayDates),
          typeOverrides: new Map<string, LeaveDayType>(dayOverrides.map((o) => [o.date, o.type as LeaveDayType])),
          caps,
        }),
      )
    : [];
  // The request is rewritten only when the plan differs from what was filed — a
  // plain approval of an in-allowance request stays a one-row status change.
  const first = segments[0];
  const unchanged =
    segments.length === 1 &&
    first !== undefined &&
    first.type === request.type &&
    first.dateFrom.getTime() === request.dateFrom!.getTime() &&
    first.dateTo.getTime() === request.dateTo!.getTime() &&
    (first.halfDay ?? false) === request.halfDay;
  // `caps` is only set when there are no manual overrides, so in that mode any
  // unpaid segment of a paid request can only have come from the allowance.
  autoCapped = caps !== null && segments.some((s) => s.type === "leave_unpaid");
  const madeHalf = segments.some((s) => s.halfDay) && halfDayDates.length > 0;

  if (!isLeaveRequest || unchanged) {
    updated = await prisma.request.update({
      where: { id: params.id },
      data: { status: RequestStatus.approved, approverId: session!.userId, approvedAt: now },
    });
  } else {
    const [head, ...rest] = segments;
    updated = await prisma.request.update({
      where: { id: params.id },
      data: {
        type: head!.type as RequestType,
        dateFrom: head!.dateFrom,
        dateTo: head!.dateTo,
        halfDay: head!.halfDay === true,
        status: RequestStatus.approved,
        approverId: session!.userId,
        approvedAt: now,
      },
    });

    for (const seg of rest) {
      const created = await prisma.request.create({
        data: {
          employeeId: request.employeeId,
          type: seg.type as RequestType,
          dateFrom: seg.dateFrom,
          dateTo: seg.dateTo,
          halfDay: seg.halfDay === true,
          description: request.description,
          status: RequestStatus.approved,
          approverId: session!.userId,
          approvedAt: now,
        },
      });
      createdIds.push(created.id);
    }
  }

  if (requester) {
    const message =
      dayOverrides.length > 0
        ? `Your ${request.type} request has been approved with some days changed to a different leave type — check Requests for the split.`
        : autoCapped
          ? `Your ${request.type} request has been approved — some days exceeded your monthly/yearly paid-leave limit and were marked unpaid.`
          : madeHalf
            ? `Your ${request.type} request has been approved with some days counted as half days — check Requests for the split.`
            : `Your ${request.type} request has been approved.`;
    await pushNotification(requester.id, `${request.type}_approved`, message);
  }

  await audit({
    action: "request.approve",
    actorUserId: session!.userId,
    actorRole: session!.role,
    entityType: "request",
    entityId: params.id,
    metadata: {
      type: request.type,
      employee_id: request.employeeId,
      ...(request.amount != null ? { amount: Number(request.amount) } : {}),
      ...(dayOverrides.length > 0 ? { day_overrides: dayOverrides, split_request_ids: createdIds } : {}),
      ...(autoCapped ? { auto_capped: true, split_request_ids: createdIds } : {}),
      ...(halfDayDates.length > 0 ? { half_day_dates: halfDayDates, split_request_ids: createdIds } : {}),
      ...(request.halfDay ? { half_day_request: true } : {}),
      ...(overrideMonthlyCap ? { admin_override: true, override_monthly_cap: true, reason: overrideReason } : {}),
    },
    ip: clientIp(req),
  });

  // An approved leave changes which days of its weeks count as unexplained
  // no-shows, which decides a week's weekly off and so any compensation credit
  // for a worked default off day — re-derive them (lib/attendance/weekly-off.ts).
  if (request.dateFrom && request.dateTo) {
    await syncCompensationCreditsForRange(request.employeeId, request.dateFrom, request.dateTo).catch(() => {});
  }

  return ok(updated);
}
