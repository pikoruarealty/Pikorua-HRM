import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isEmployeeRole, isLeadRole, Role } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { WorkItemMode, WorkItemFrequency } from "@prisma/client";

// Track B. GET /api/v1/work-items/mine — Milestone 1.2.
// Any role that can be a WorkItem assignee can query their own tasks here —
// Leads have Employee records too and can be assigned WorkItems just like
// anyone else, so they're not excluded (API_SPEC.md's "Employee" row means
// "self", not the strict EMPLOYEE_ROLES group). HR clocks in and works like
// an employee day-to-day (unlike Admin, who doesn't clock in — the "My
// Tasks" nav item is hidden for Admin but shown for HR), so HR is included
// too (2026-08-11 fix — the nav already promised this, the route didn't).

// A daily-recurring item (metric mode + frequency=daily, e.g. a sales rep's
// calls target, or an atomic item flagged repeatDaily) gets a brand-new row
// every day by design (metric-daily-rollover.ts) — that's what lets an admin
// see the full day-by-day history on the WorkUnit/SubUnit screen. But that
// same history should not pile up as "still active" in the employee's own
// task list: a rep who didn't hit 100 calls yesterday shouldn't see
// yesterday's stale Calls task sitting there alongside today's forever
// (2026-09-18 bug fix — reported as tasks "stacking" past 20+ items). Only
// the newest instance of each recurring chain is live; older instances are
// history, visible to Admin/Lead elsewhere, not surfaced here.
function isDailyRecurring(item: { mode: WorkItemMode; frequency: WorkItemFrequency | null; repeatDaily: boolean }) {
  return (item.mode === WorkItemMode.metric && item.frequency === WorkItemFrequency.daily) || item.repeatDaily;
}

function recurrenceKey(item: { subUnitId: string; salesMetric: string | null; title: string; mode: WorkItemMode }) {
  return item.mode === WorkItemMode.metric
    ? `metric:${item.subUnitId}:${item.salesMetric ?? "-"}`
    : `atomic:${item.subUnitId}:${item.title}`;
}

export async function GET() {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!isEmployeeRole(session.role) && !isLeadRole(session.role) && session.role !== Role.hr) {
    return failFor(ErrorCode.FORBIDDEN);
  }
  if (!session.employeeId) return ok([]);

  const workItems = await prisma.workItem.findMany({
    where: { assignedTo: session.employeeId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });

  const latestRecurringByKey = new Map<string, (typeof workItems)[number]>();
  const regular: typeof workItems = [];
  for (const item of workItems) {
    if (!isDailyRecurring(item)) {
      regular.push(item);
      continue;
    }
    // `workItems` is already newest-first (orderBy createdAt desc), so the
    // first hit per key is the current live instance.
    const key = recurrenceKey(item);
    if (!latestRecurringByKey.has(key)) latestRecurringByKey.set(key, item);
  }

  const visible = [...regular, ...latestRecurringByKey.values()].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );

  return ok(visible);
}
