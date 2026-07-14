import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { EventType } from "@prisma/client";

// Track B. POST/GET /api/v1/events/meetings — Milestone 3.5.
// RBAC: POST = Admin, HR, Lead. GET = Any, scoped to meetings the caller is
// invited to (directly or via their team) or created.

const createSchema = z.object({
  title: z.string().min(1),
  scheduledAt: z.coerce.date(),
  reminderLeadMinutes: z.number().int().nonnegative(),
  inviteeEmployeeIds: z.array(z.string().uuid()).optional(),
  inviteeTeamIds: z.array(z.string().uuid()).optional(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!isFinanceRole(session.role) && !isLeadRole(session.role)) {
    return failFor(ErrorCode.FORBIDDEN);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return failFor(ErrorCode.VALIDATION, "Invalid request body.");
  const { title, scheduledAt, reminderLeadMinutes, inviteeEmployeeIds, inviteeTeamIds } = parsed.data;

  if ((!inviteeEmployeeIds || inviteeEmployeeIds.length === 0) && (!inviteeTeamIds || inviteeTeamIds.length === 0)) {
    return failFor(ErrorCode.VALIDATION, "At least one invitee_employee_id or invitee_team_id is required.");
  }

  const event = await prisma.event.create({
    data: {
      type: EventType.meeting,
      title,
      createdById: session.userId,
      scheduledAt,
      reminderLeadMinutes,
      invitees: {
        create: [
          ...(inviteeEmployeeIds ?? []).map((employeeId) => ({ employeeId })),
          ...(inviteeTeamIds ?? []).map((teamId) => ({ teamId })),
        ],
      },
    },
    include: { invitees: true },
  });

  return ok(event, 201);
}

export async function GET() {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  if (isFinanceRole(session.role)) {
    const meetings = await prisma.event.findMany({
      where: { type: EventType.meeting },
      include: { invitees: true },
      orderBy: { scheduledAt: "asc" },
    });
    return ok(meetings);
  }

  if (!session.employeeId) return ok([]);
  const employee = await prisma.employee.findUnique({
    where: { id: session.employeeId },
    select: { teamId: true },
  });

  const meetings = await prisma.event.findMany({
    where: {
      type: EventType.meeting,
      OR: [
        { createdById: session.userId },
        { invitees: { some: { employeeId: session.employeeId } } },
        ...(employee?.teamId ? [{ invitees: { some: { teamId: employee.teamId } } }] : []),
      ],
    },
    include: { invitees: true },
    orderBy: { scheduledAt: "asc" },
  });
  return ok(meetings);
}
