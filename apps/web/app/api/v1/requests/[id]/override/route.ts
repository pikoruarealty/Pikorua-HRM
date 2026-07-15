import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { Role } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { pushNotification } from "@/lib/notifications/push";
import { RequestStatus } from "@prisma/client";
import { audit, clientIp } from "@/lib/audit";

// Admin manual override (2026-07-15). PATCH /api/v1/requests/:id/override —
// **Admin only** (narrower than approve/reject's Admin/HR): force a request
// into ANY status regardless of its current one — undo a mistaken approval,
// reopen a rejection, etc. A reason is mandatory and lands in the audit
// trail. Unlike /approve, Admin self-requests are allowed here (Admin is the
// top of the hierarchy and this is explicitly the escape hatch).

const overrideSchema = z.object({
  status: z.nativeEnum(RequestStatus),
  reason: z.string().min(3, "A reason is required for an override."),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (session.role !== Role.admin) return failFor(ErrorCode.FORBIDDEN);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
  }
  const parsed = overrideSchema.safeParse(body);
  if (!parsed.success) {
    return failFor(ErrorCode.VALIDATION, parsed.error.issues[0]?.message ?? "Invalid override.");
  }

  const request = await prisma.request.findUnique({ where: { id: params.id } });
  if (!request) return failFor(ErrorCode.NOT_FOUND);
  if (request.status === parsed.data.status) {
    return failFor(ErrorCode.CONFLICT, `Request is already ${parsed.data.status}.`);
  }

  const updated = await prisma.request.update({
    where: { id: params.id },
    data: {
      status: parsed.data.status,
      // Back to pending clears the approval stamp; any decided status records
      // the overriding admin as the approver.
      approverId: parsed.data.status === RequestStatus.pending ? null : session.userId,
      approvedAt: parsed.data.status === RequestStatus.pending ? null : new Date(),
    },
  });

  const requester = await prisma.user.findUnique({ where: { employeeId: request.employeeId } });
  if (requester) {
    await pushNotification(
      requester.id,
      `${request.type}_overridden`,
      `An admin changed your ${request.type} request from ${request.status} to ${parsed.data.status}.`,
    );
  }

  await audit({
    action: "request.override",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "request",
    entityId: params.id,
    metadata: {
      type: request.type,
      employee_id: request.employeeId,
      status_before: request.status,
      status_after: parsed.data.status,
      reason: parsed.data.reason,
    },
    ip: clientIp(req),
  });

  return ok(updated);
}
