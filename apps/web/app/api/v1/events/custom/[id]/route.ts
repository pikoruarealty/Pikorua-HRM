import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { audit, clientIp } from "@/lib/audit";
import { EventType } from "@prisma/client";

// Track B. PATCH/DELETE /api/v1/events/custom/:id — Admin/HR only (see
// POST /events/custom for the rationale).

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  scheduledAt: z.coerce.date().optional(),
  reminderLeadMinutes: z.number().int().nonnegative().nullable().optional(),
});

async function loadCustomEvent(id: string) {
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event || event.type !== EventType.custom) return null;
  return event;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!isFinanceRole(session.role)) return failFor(ErrorCode.FORBIDDEN);

  const event = await loadCustomEvent(params.id);
  if (!event) return failFor(ErrorCode.NOT_FOUND);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return failFor(ErrorCode.VALIDATION, "Invalid request body.");
  const { title, scheduledAt, reminderLeadMinutes } = parsed.data;

  const updated = await prisma.event.update({
    where: { id: event.id },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(scheduledAt !== undefined ? { scheduledAt } : {}),
      ...(reminderLeadMinutes !== undefined ? { reminderLeadMinutes } : {}),
    },
  });

  await audit({
    action: "event.update",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "event",
    entityId: event.id,
    ip: clientIp(req),
  });

  return ok(updated);
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!isFinanceRole(session.role)) return failFor(ErrorCode.FORBIDDEN);

  const event = await loadCustomEvent(params.id);
  if (!event) return failFor(ErrorCode.NOT_FOUND);

  await prisma.event.delete({ where: { id: event.id } });

  await audit({
    action: "event.delete",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "event",
    entityId: event.id,
    ip: clientIp(req),
  });

  return ok({ deleted: true });
}
