import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, Role, requireRole, AuthzError } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { pushNotification } from "@/lib/notifications/push";
import { RequestStatus, RequestType } from "@prisma/client";
import { audit, clientIp } from "@/lib/audit";
import {
  splitLeaveRangeByOverrides,
  allocateLeaveDaysAgainstCaps,
  isPaidLeaveType,
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

  if (dayOverrides.length > 0) {
    if (!LEAVE_TYPES.includes(request.type) || !request.dateFrom || !request.dateTo) {
      return failFor(ErrorCode.VALIDATION, "day_overrides only applies to leave requests.");
    }
    for (const o of dayOverrides) {
      if (!LEAVE_TYPES.includes(o.type)) {
        return failFor(ErrorCode.VALIDATION, "day_overrides type must be leave_casual, leave_sick, or leave_unpaid.");
      }
      const d = new Date(`${o.date}T00:00:00.000Z`);
      if (d < request.dateFrom || d > request.dateTo) {
        return failFor(ErrorCode.VALIDATION, `${o.date} is outside this request's date range.`);
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
  let autoOverrideMap: Map<string, LeaveDayType> | null = null;
  if (
    dayOverrides.length === 0 &&
    !overrideMonthlyCap &&
    isPaidLeaveType(request.type) &&
    request.dateFrom &&
    request.dateTo
  ) {
    const dateFrom = request.dateFrom;
    const dateTo = request.dateTo;
    const [{ monthlyCap, yearlyCap }, approvedByMonth, approvedThisYear] = await Promise.all([
      getEffectivePaidLeaveCaps(request.employeeId, dateFrom.getUTCMonth() + 1, dateFrom.getUTCFullYear()),
      getApprovedPaidLeaveDaysByMonthsInRange(request.employeeId, dateFrom, dateTo),
      getApprovedPaidLeaveDaysForYear(request.employeeId, dateFrom.getUTCFullYear()),
    ]);
    const overrides = allocateLeaveDaysAgainstCaps(
      dateFrom,
      dateTo,
      approvedByMonth,
      approvedThisYear,
      monthlyCap,
      yearlyCap,
    );
    if (overrides.size > 0) {
      autoOverrideMap = overrides;
      autoCapped = true;
    }
  }

  if (dayOverrides.length === 0 && !autoOverrideMap) {
    updated = await prisma.request.update({
      where: { id: params.id },
      data: { status: RequestStatus.approved, approverId: session!.userId, approvedAt: now },
    });
  } else {
    const overrideMap =
      dayOverrides.length > 0
        ? new Map<string, LeaveDayType>(dayOverrides.map((o) => [o.date, o.type as LeaveDayType]))
        : autoOverrideMap!;
    const segments = splitLeaveRangeByOverrides(
      request.dateFrom!,
      request.dateTo!,
      request.type as LeaveDayType,
      overrideMap,
    );

    const [first, ...rest] = segments;
    updated = await prisma.request.update({
      where: { id: params.id },
      data: {
        type: first.type as RequestType,
        dateFrom: first.dateFrom,
        dateTo: first.dateTo,
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
      ...(overrideMonthlyCap ? { admin_override: true, override_monthly_cap: true, reason: overrideReason } : {}),
    },
    ip: clientIp(req),
  });

  return ok(updated);
}
