import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isEmployeeRole, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";

// Track B. POST /api/v1/daily-selections — Milestone 2.3.
// Called at clock-in: employee selects which of their assigned WorkItems
// they intend to work on today. Additive (skipDuplicates) rather than a
// full replace, so re-calling later in the day to add more tasks is safe.
// Leads are allowed here too (self-service on their own assigned items) —
// the "Employee" role in API_SPEC.md means "self", not the strict
// EMPLOYEE_ROLES group; see the matching note in work-items/mine/route.ts.

const createSchema = z.object({
  workItemIds: z.array(z.string().uuid()).min(1),
});

function todayUtcDate(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!isEmployeeRole(session.role) && !isLeadRole(session.role)) return failFor(ErrorCode.FORBIDDEN);
  if (!session.employeeId) return failFor(ErrorCode.FORBIDDEN, "Session has no linked employee record.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return failFor(ErrorCode.VALIDATION, "workItemIds must be a non-empty array of UUIDs.");
  }
  const { workItemIds } = parsed.data;

  const uniqueIds = [...new Set(workItemIds)];
  const workItems = await prisma.workItem.findMany({ where: { id: { in: uniqueIds } } });
  if (workItems.length !== uniqueIds.length || workItems.some((w) => w.assignedTo !== session.employeeId)) {
    return failFor(ErrorCode.VALIDATION, "All workItemIds must reference WorkItems assigned to you.");
  }

  const date = todayUtcDate();
  await prisma.dailyTaskSelection.createMany({
    data: uniqueIds.map((workItemId) => ({ employeeId: session.employeeId!, workItemId, date })),
    skipDuplicates: true,
  });

  const selections = await prisma.dailyTaskSelection.findMany({
    where: { employeeId: session.employeeId, date },
    include: { workItem: true },
    orderBy: { createdAt: "asc" },
  });

  return ok(selections, 201);
}
