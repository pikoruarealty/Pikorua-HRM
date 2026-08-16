import { WorkItemMode, WorkItemStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { createLogger } from "@/lib/log";
import { LEAD_ROLES } from "@/lib/rbac";

// Self-logged ad-hoc tasks (2026-08-10, owner request: "for the tech employees
// if no tasks assigned, employees can log new tasks themselves while clock in
// or during the day, but need to figure out the point system for that").
//
// The point system, and the reason it looks like this: **nobody judges
// difficulty**. An employee estimating their own points would be marking their
// own exam, and a Lead estimating them is a technical judgement a non-technical
// Lead can't make. So the employee picks a *type* from a fixed catalog whose
// points an Admin set in advance, and the Lead answers exactly one question at
// review — "did this happen, yes or no". That question anyone can answer.
//
// Consequences that follow from it:
//   - A self-logged task ALWAYS goes through review, whatever it's worth. The
//     tiered threshold exists to spare a Lead from rubber-stamping small
//     assigned work; here the review IS the only check that the work happened.
//   - The employee never sends a number. `taskPoints` is copied server-side
//     from the catalog row, so a crafted request can't inflate it.
//   - Monthly self-logged points are capped as a share of the employee's total
//     (`performance_config.self_logged_cap_percent`), so self-logging can't
//     become the cheapest route to a high output score. The cap is applied
//     where scores are computed, not at approval — refusing to accept work that
//     genuinely happened would be a lie about the work, and the Lead would have
//     no way to act on it.

const logger = createLogger("adhoc-tasks");

export const ADHOC_CONTAINER_WORK_UNIT = "Ad-hoc Work";
export const ADHOC_CONTAINER_SUB_UNIT = "Self-logged Tasks";

/**
 * The container SubUnit that self-logged tasks hang off, per department,
 * created on first use.
 *
 * Same reasoning as the sales container (`lib/sales/provisioning.ts`):
 * `WorkItem.subUnitId` is non-null, and inventing a parallel "loose tasks"
 * concept outside the WorkUnit tree would fork every downstream reader. The
 * WorkUnit's project lead matters here in a way it doesn't for sales — it is
 * who the review notification goes to — so a real Lead is preferred, with the
 * first active member only as a fallback for a lead-less department.
 *
 * Returns null when the department has nobody at all; there is then no one to
 * log tasks either.
 */
export async function ensureAdhocContainer(departmentId: string): Promise<string | null> {
  const existing = await prisma.subUnit.findFirst({
    where: {
      name: ADHOC_CONTAINER_SUB_UNIT,
      deletedAt: null,
      workUnit: { departmentId, name: ADHOC_CONTAINER_WORK_UNIT, deletedAt: null },
    },
    select: {
      id: true,
      workUnit: { select: { id: true, projectLeadId: true } },
    },
  });

  // Re-resolve the current lead every call, not just at creation — the
  // WorkUnit's project lead is who review notifications go to, so if the
  // employee it was set to has since left the department (or gone inactive)
  // the container would otherwise keep pointing at them forever, and every
  // self-logged task filed after that would sit unreviewable by anyone.
  const currentLead =
    (await prisma.employee.findFirst({
      where: { departmentId, status: "active", role: { in: [...LEAD_ROLES] } },
      select: { id: true },
    })) ??
    (await prisma.employee.findFirst({
      where: { departmentId, status: "active" },
      select: { id: true },
    }));

  if (existing) {
    if (currentLead && existing.workUnit.projectLeadId !== currentLead.id) {
      const stillValid = await prisma.employee.findFirst({
        where: { id: existing.workUnit.projectLeadId, departmentId, status: "active" },
        select: { id: true },
      });
      if (!stillValid) {
        await prisma.workUnit.update({
          where: { id: existing.workUnit.id },
          data: { projectLeadId: currentLead.id },
        });
        logger.info("re-pointed stale ad-hoc container lead", {
          departmentId,
          workUnitId: existing.workUnit.id,
          newLeadId: currentLead.id,
        });
      }
    }
    return existing.id;
  }

  if (!currentLead) {
    logger.warn("cannot provision ad-hoc container — department has no active employees", { departmentId });
    return null;
  }

  const workUnit =
    (await prisma.workUnit.findFirst({
      where: { departmentId, name: ADHOC_CONTAINER_WORK_UNIT, deletedAt: null },
      select: { id: true },
    })) ??
    (await prisma.workUnit.create({
      data: {
        departmentId,
        name: ADHOC_CONTAINER_WORK_UNIT,
        description:
          "Auto-managed container for tasks employees log themselves. Every item here is reviewed by the department lead before its points count.",
        projectLeadId: currentLead.id,
      },
      select: { id: true },
    }));

  const subUnit = await prisma.subUnit.create({
    data: { workUnitId: workUnit.id, name: ADHOC_CONTAINER_SUB_UNIT },
    select: { id: true },
  });
  logger.info("provisioned ad-hoc container", { departmentId, subUnitId: subUnit.id });
  return subUnit.id;
}

/**
 * How many of an employee's credited points this month came from self-logged
 * work, and how many are allowed to.
 *
 * `capPercent` is a share of the employee's *total* credited points for the
 * month, so the ceiling rises with assigned output — an employee doing plenty
 * of assigned work can log more ad-hoc work than one doing none. The floor case
 * matters: with zero assigned points the cap is zero, which would make a month
 * of pure ad-hoc work count for nothing. That is the intended reading — ad-hoc
 * logging supplements assigned work rather than replacing it — and is exactly
 * why `scoringEnabled` starts off during the grace period.
 */
export function cappedSelfLoggedPoints(args: {
  selfLoggedPoints: number;
  totalPoints: number;
  capPercent: number;
}): { allowed: number; excluded: number } {
  const pct = Math.min(Math.max(args.capPercent, 0), 100);
  const ceiling = Math.floor((args.totalPoints * pct) / 100);
  const allowed = Math.min(args.selfLoggedPoints, ceiling);
  return { allowed, excluded: Math.max(args.selfLoggedPoints - allowed, 0) };
}

/**
 * Credited points for one employee in one month, split into self-logged and
 * assigned. Reads the ledger (not WorkItem.status), because the ledger is what
 * the score is built from and it only ever holds *credited* work — a pending
 * self-logged task, or one the Lead declined, has no row and so counts for
 * nothing here, which is the whole point of routing it through review.
 */
export async function monthlyPointSplit(
  employeeId: string,
  year: number,
  month: number,
): Promise<{ selfLoggedPoints: number; totalPoints: number }> {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  const rows = await prisma.employeePointLedger.findMany({
    where: { employeeId, creditedAt: { gte: start, lt: end } },
    select: { points: true, workItemId: true },
  });
  const selfLoggedIds = new Set(
    (
      await prisma.workItem.findMany({
        where: { id: { in: rows.map((r) => r.workItemId) }, selfLogged: true },
        select: { id: true },
      })
    ).map((w) => w.id),
  );
  let selfLoggedPoints = 0;
  let totalPoints = 0;
  for (const r of rows) {
    totalPoints += r.points;
    if (selfLoggedIds.has(r.workItemId)) selfLoggedPoints += r.points;
  }
  return { selfLoggedPoints, totalPoints };
}

/**
 * Create one self-logged task for an employee. Points come from the catalog,
 * never from the caller. The task starts `pending`: logging it is a claim that
 * work is underway, and completing it is what sends it to the Lead.
 */
export async function createSelfLoggedTask(args: {
  employeeId: string;
  departmentId: string;
  adhocTypeId: string;
  points: number;
  title: string;
  description: string | null;
}): Promise<{ id: string } | null> {
  const subUnitId = await ensureAdhocContainer(args.departmentId);
  if (!subUnitId) return null;

  const created = await prisma.workItem.create({
    data: {
      subUnitId,
      assignedTo: args.employeeId,
      title: args.title,
      description: args.description,
      mode: WorkItemMode.atomic,
      taskPoints: args.points,
      status: WorkItemStatus.pending,
      selfLogged: true,
      adhocTypeId: args.adhocTypeId,
      // Logged today, done today (or not) — a self-logged task with no date
      // would sit outside the timeliness component entirely.
      dueDate: new Date(new Date().toISOString().slice(0, 10)),
    },
    select: { id: true },
  });
  logger.info("self-logged task created", {
    employeeId: args.employeeId,
    workItemId: created.id,
    points: args.points,
  });
  return created;
}

/**
 * Create one *free-text* self-logged task — for work that doesn't fit any
 * catalog type. Unlike the catalog path (fixed price, Admin-set), this one is
 * priced by Groq at creation time (see `estimateSelfLoggedTaskPoints`) using
 * the same story-point scale the AI task-breakdown feature already uses for
 * assigned work — `points` here is that estimate, computed by the caller so
 * this function stays a pure DB write. Because it's a real number (not null),
 * completing the task goes through the ordinary tiered-review threshold
 * (lib/work/review.ts) exactly like an assigned task: small estimates credit
 * immediately, larger ones still go to the Lead.
 */
export async function createFreeTextSelfLoggedTask(args: {
  employeeId: string;
  departmentId: string;
  title: string;
  description: string;
  points: number;
}): Promise<{ id: string } | null> {
  const subUnitId = await ensureAdhocContainer(args.departmentId);
  if (!subUnitId) return null;

  const created = await prisma.workItem.create({
    data: {
      subUnitId,
      assignedTo: args.employeeId,
      title: args.title,
      description: args.description,
      mode: WorkItemMode.atomic,
      taskPoints: args.points,
      status: WorkItemStatus.pending,
      selfLogged: true,
      adhocTypeId: null,
      dueDate: new Date(new Date().toISOString().slice(0, 10)),
    },
    select: { id: true },
  });
  logger.info("free-text self-logged task created", {
    employeeId: args.employeeId,
    workItemId: created.id,
    points: args.points,
  });
  return created;
}
