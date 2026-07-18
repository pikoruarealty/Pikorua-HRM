import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { WorkItemMode } from "@prisma/client";

// Track B. GET /api/v1/employees/:id/work-items/history — Milestone 2.2.
// Growth-over-time view for metric-mode WorkItems (Sales/BD): one row per
// period_month/period_year (2.1 decision), so history is a plain query
// across an employee's past periods rather than a snapshot table.
// NOTE: physically lives under Track A's `app/api/v1/employees/` folder —
// owned by Track B (per TRACK_B_TASKLIST 2.3 note); flag Umang once, no
// existing Track A file touched.

const querySchema = z.object({
  year: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().positive().max(60).optional(),
});

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const employee = await prisma.employee.findUnique({
    where: { id: params.id },
    include: { team: true },
  });
  if (!employee) return failFor(ErrorCode.NOT_FOUND);

  const role = session.role;
  const isSelf = session.employeeId === employee.id;
  const isOwningLead = isLeadRole(role) && session.employeeId === employee.team?.teamLeadId;
  if (!isFinanceRole(role) && !isOwningLead && !isSelf) {
    return failFor(ErrorCode.FORBIDDEN);
  }

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return failFor(ErrorCode.VALIDATION, "Invalid query parameters.");
  }
  const { year, limit } = parsed.data;

  const history = await prisma.workItem.findMany({
    where: {
      assignedTo: employee.id,
      mode: WorkItemMode.metric,
      deletedAt: null,
      ...(year !== undefined ? { periodYear: year } : {}),
    },
    orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }, { periodDay: "desc" }],
    take: limit ?? 24,
  });

  return ok(
    history.map((item) => ({
      id: item.id,
      title: item.title,
      frequency: item.frequency,
      periodMonth: item.periodMonth,
      periodYear: item.periodYear,
      periodDay: item.periodDay,
      targetValue: item.targetValue,
      currentValue: item.currentValue,
      achievedPct:
        item.targetValue && Number(item.targetValue) > 0
          ? Number(((Number(item.currentValue ?? 0) / Number(item.targetValue)) * 100).toFixed(1))
          : null,
      status: item.status,
    })),
  );
}
