import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { audit, clientIp } from "@/lib/audit";
import { EventType } from "@prisma/client";

// Track B. POST/GET /api/v1/events/custom — 2026-08-07 addition. Admin/HR log
// a one-off milestone against a single employee (work anniversary note,
// recognition date, etc.) — distinct from `meeting`, which needs invitees,
// and from the auto-derived `birthday`/`anniversary` events. Admin/HR only,
// both directions: this is HR-authored record-keeping, not self-service.

const createSchema = z.object({
  employeeId: z.string().uuid(),
  title: z.string().min(1).max(200),
  scheduledAt: z.coerce.date(),
  reminderLeadMinutes: z.number().int().nonnegative().optional(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!isFinanceRole(session.role)) return failFor(ErrorCode.FORBIDDEN);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return failFor(ErrorCode.VALIDATION, "Invalid request body.");
  const { employeeId, title, scheduledAt, reminderLeadMinutes } = parsed.data;

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return failFor(ErrorCode.VALIDATION, "employeeId does not reference an existing employee.");

  const event = await prisma.event.create({
    data: {
      type: EventType.custom,
      title,
      createdById: session.userId,
      employeeId,
      scheduledAt,
      reminderLeadMinutes,
    },
  });

  await audit({
    action: "event.create",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "event",
    entityId: event.id,
    metadata: { employeeId, title },
    ip: clientIp(req),
  });

  return ok(event, 201);
}

// GET — Admin/HR see all custom events, optionally filtered by ?employee_id=;
// anyone else (e.g. viewing their own profile) only sees events about
// themselves.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const { searchParams } = new URL(req.url);
  const employeeIdFilter = searchParams.get("employee_id") ?? undefined;

  if (isFinanceRole(session.role)) {
    const events = await prisma.event.findMany({
      where: { type: EventType.custom, ...(employeeIdFilter ? { employeeId: employeeIdFilter } : {}) },
      orderBy: { scheduledAt: "desc" },
    });
    return ok(events);
  }

  if (!session.employeeId) return ok([]);
  const events = await prisma.event.findMany({
    where: { type: EventType.custom, employeeId: session.employeeId },
    orderBy: { scheduledAt: "desc" },
  });
  return ok(events);
}
