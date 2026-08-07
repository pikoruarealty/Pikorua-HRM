import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { redactRequestFinancials } from "@/lib/requests/redact";
import { audit, clientIp } from "@/lib/audit";
import { RequestType, RequestStatus } from "@prisma/client";

// Track B. GET/PATCH/DELETE /api/v1/requests/:id — Milestone 1.3, extended
// 2026-08-07 with self-service edit/delete: the creating employee may edit or
// delete their OWN request only while it's still `pending` — once it's been
// decided (approved/rejected) only the admin override/hard-delete paths apply.

const LEAVE_TYPES: RequestType[] = [RequestType.leave_paid, RequestType.leave_unpaid];

const EMPLOYEE_SUMMARY = {
  select: {
    id: true,
    fullName: true,
    email: true,
    role: true,
    department: { select: { name: true } },
    team: { select: { name: true } },
  },
} as const;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const request = await prisma.request.findUnique({
    where: { id: params.id },
    include: { employee: EMPLOYEE_SUMMARY },
  });
  if (!request) return failFor(ErrorCode.NOT_FOUND);
  const withFlag = { ...request, hasAttachment: request.attachmentUrl != null };

  const role = session.role;
  // Only Admin/HR see reimbursement financial fields (golden rule); everyone
  // else gets the amount/attachment stripped.
  if (isFinanceRole(role)) return ok(withFlag);

  if (!session.employeeId) return failFor(ErrorCode.NOT_FOUND);

  // The owner sees their own financials (they filed it and can open their own
  // bill); everyone below finance has amount/attachment stripped.
  if (request.employeeId === session.employeeId) return ok(withFlag);

  if (isLeadRole(role)) {
    const team = await prisma.team.findFirst({
      where: { teamLeadId: session.employeeId, members: { some: { id: request.employeeId } } },
    });
    if (team) return ok({ ...redactRequestFinancials(withFlag), hasAttachment: false });
  }

  // Don't reveal existence of Requests outside the caller's scope.
  return failFor(ErrorCode.NOT_FOUND);
}

const patchSchema = z.object({
  type: z.nativeEnum(RequestType).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  amount: z.number().positive().optional(),
  description: z.string().optional(),
});

// PATCH — the creating employee may edit their own request while it's still
// pending. No admin/lead path here (that's the override route).
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!session.employeeId) return failFor(ErrorCode.FORBIDDEN, "Session has no linked employee record.");

  const existing = await prisma.request.findUnique({ where: { id: params.id } });
  if (!existing) return failFor(ErrorCode.NOT_FOUND);
  if (existing.employeeId !== session.employeeId) return failFor(ErrorCode.NOT_FOUND);
  if (existing.status !== RequestStatus.pending) {
    return failFor(ErrorCode.VALIDATION, "Only pending requests can be edited.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return failFor(ErrorCode.VALIDATION, "Invalid request body.");
  const { type, dateFrom, dateTo, amount, description } = parsed.data;

  const effectiveType = type ?? existing.type;
  if (LEAVE_TYPES.includes(effectiveType)) {
    const effectiveFrom = dateFrom ?? existing.dateFrom;
    const effectiveTo = dateTo ?? existing.dateTo;
    if (!effectiveFrom || !effectiveTo) {
      return failFor(ErrorCode.VALIDATION, "dateFrom and dateTo are required for leave requests.");
    }
    if (effectiveTo < effectiveFrom) {
      return failFor(ErrorCode.VALIDATION, "dateTo must be on or after dateFrom.");
    }
  } else if (effectiveType === RequestType.reimbursement) {
    const effectiveAmount = amount ?? (existing.amount ? Number(existing.amount) : undefined);
    if (effectiveAmount === undefined) {
      return failFor(ErrorCode.VALIDATION, "amount is required for reimbursement requests.");
    }
  }

  const updated = await prisma.request.update({
    where: { id: existing.id },
    data: {
      ...(type !== undefined ? { type } : {}),
      ...(dateFrom !== undefined ? { dateFrom } : {}),
      ...(dateTo !== undefined ? { dateTo } : {}),
      ...(amount !== undefined ? { amount } : {}),
      ...(description !== undefined ? { description } : {}),
    },
  });

  await audit({
    action: "request.edit",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "request",
    entityId: existing.id,
    ip: clientIp(req),
  });

  return ok(updated);
}

// DELETE — the creating employee may delete their own request while it's
// still pending (Admin's any-status delete is a separate, wider grant — see
// the admin hard-delete check below).
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const existing = await prisma.request.findUnique({ where: { id: params.id } });
  if (!existing) return failFor(ErrorCode.NOT_FOUND);

  const isOwner = existing.employeeId === session.employeeId;
  const isAdmin = isFinanceRole(session.role);

  if (isAdmin) {
    // Admin may delete a request in any status — permanent junk-data cleanup.
    await prisma.request.delete({ where: { id: existing.id } });
    await audit({
      action: "request.delete_admin",
      actorUserId: session.userId,
      actorRole: session.role,
      entityType: "request",
      entityId: existing.id,
      metadata: { status_at_delete: existing.status },
      ip: clientIp(req),
    });
    return ok({ deleted: true });
  }

  if (!isOwner) return failFor(ErrorCode.NOT_FOUND);
  if (existing.status !== RequestStatus.pending) {
    return failFor(ErrorCode.VALIDATION, "Only pending requests can be deleted.");
  }

  await prisma.request.delete({ where: { id: existing.id } });
  await audit({
    action: "request.delete_own",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "request",
    entityId: existing.id,
    ip: clientIp(req),
  });

  return ok({ deleted: true });
}
