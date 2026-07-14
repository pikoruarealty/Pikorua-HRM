import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { EventType, type Role } from "@prisma/client";

// Track B. PATCH/DELETE /api/v1/events/meetings/:id — Milestone 3.5.
// RBAC: Creator or Admin/HR.

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  scheduledAt: z.coerce.date().optional(),
  reminderLeadMinutes: z.number().int().nonnegative().optional(),
  inviteeEmployeeIds: z.array(z.string().uuid()).optional(),
  inviteeTeamIds: z.array(z.string().uuid()).optional(),
});

async function loadMeetingAndAuthorize(id: string, session: { userId: string; role: Role }) {
  const meeting = await prisma.event.findUnique({ where: { id } });
  if (!meeting || meeting.type !== EventType.meeting) return { meeting: null, authorized: false };
  const authorized = isFinanceRole(session.role) || meeting.createdById === session.userId;
  return { meeting, authorized };
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const { meeting, authorized } = await loadMeetingAndAuthorize(params.id, session);
  if (!meeting) return failFor(ErrorCode.NOT_FOUND);
  if (!authorized) return failFor(ErrorCode.FORBIDDEN);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return failFor(ErrorCode.VALIDATION, "Invalid request body.");
  const { title, scheduledAt, reminderLeadMinutes, inviteeEmployeeIds, inviteeTeamIds } = parsed.data;

  const replacingInvitees = inviteeEmployeeIds !== undefined || inviteeTeamIds !== undefined;

  const updated = await prisma.$transaction(async (tx) => {
    if (replacingInvitees) {
      await tx.eventInvitee.deleteMany({ where: { eventId: meeting.id } });
    }
    return tx.event.update({
      where: { id: meeting.id },
      data: {
        title: title ?? undefined,
        scheduledAt: scheduledAt ?? undefined,
        reminderLeadMinutes: reminderLeadMinutes ?? undefined,
        invitees: replacingInvitees
          ? {
              create: [
                ...(inviteeEmployeeIds ?? []).map((employeeId) => ({ employeeId })),
                ...(inviteeTeamIds ?? []).map((teamId) => ({ teamId })),
              ],
            }
          : undefined,
      },
      include: { invitees: true },
    });
  });

  return ok(updated);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const { meeting, authorized } = await loadMeetingAndAuthorize(params.id, session);
  if (!meeting) return failFor(ErrorCode.NOT_FOUND);
  if (!authorized) return failFor(ErrorCode.FORBIDDEN);

  await prisma.event.delete({ where: { id: meeting.id } });
  return ok({ deleted: true });
}
