import { prisma } from "@/lib/db/prisma";
import { addDays, dateKey, weekStartOf } from "@/lib/attendance/week";
import { todayDateOnly } from "@/lib/attendance/time";
import { splitHoursByLocation } from "@/lib/attendance/calendar";

// Weekly WFH-hours target for part-time / intern staff, with an advance/late
// offset (2026-09-30, owner request: "runs through the same compensation logic,
// advance or late"). Admin sets Employee.expectedWfhHoursPerWeek; each week the
// approved WFH hours are compared with it and a running balance is kept:
//
//  - a SURPLUS (worked ahead) is banked for 60 days and covers a later shortfall
//    — "advance";
//  - a SHORTFALL stays open for 60 days and is covered by a later surplus —
//    "late" make-up;
//  - a shortfall that nothing covers in time is "unmet".
//
// Same 60-day window as compensation credits (lib/attendance/compensation-
// credits.ts). Tracking only: by the owner's decision this does NOT touch
// payroll — there is no hourly rate behind it. Known limit: the target is the
// same every week; weeks with approved leave or a holiday are not pro-rated.

export const WFH_WINDOW_DAYS = 60;
const MS_PER_DAY = 86_400_000;
const EPS = 1e-9;

export type WfhWeekInput = { weekStart: Date; worked: number; complete: boolean };

export type WfhWeek = { weekStart: string; worked: number; target: number; complete: boolean };

export type WfhBalance = {
  /** Banked hours still usable against a shortfall. */
  bankedHours: number;
  bankedUntil: string | null;
  /** Shortfall still open and inside its window — can still be made up. */
  owedHours: number;
  owedUntil: string | null;
  /** Shortfall whose window closed uncovered. */
  unmetHours: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Pure: the balance after walking `weeks` (oldest first) against a weekly target.
 * Only `complete` weeks create a surplus or a shortfall — a week still in
 * progress hasn't failed yet. `now` decides which windows have closed.
 */
export function computeWfhBalance(weeks: WfhWeekInput[], target: number, now: Date): WfhBalance {
  type Lot = { amount: number; until: number };
  let surpluses: Lot[] = [];
  let deficits: Lot[] = [];
  let unmet = 0;

  const expire = (at: number) => {
    surpluses = surpluses.filter((s) => s.until >= at);
    const still: Lot[] = [];
    for (const d of deficits) {
      if (d.until < at) unmet += d.amount;
      else still.push(d);
    }
    deficits = still;
  };

  for (const w of [...weeks].sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime())) {
    if (!w.complete) continue;
    const weekEnd = addDays(w.weekStart, 7).getTime();
    expire(weekEnd);
    const until = weekEnd + WFH_WINDOW_DAYS * MS_PER_DAY;
    const delta = w.worked - target;

    if (delta > EPS) {
      // Worked over: first make up the oldest open shortfall, bank the rest.
      let left = delta;
      for (const d of deficits) {
        const use = Math.min(left, d.amount);
        d.amount -= use;
        left -= use;
        if (left <= EPS) break;
      }
      deficits = deficits.filter((d) => d.amount > EPS);
      if (left > EPS) surpluses.push({ amount: left, until });
    } else if (delta < -EPS) {
      // Fell short: spend the oldest banked surplus first, the rest stays owed.
      let need = -delta;
      for (const s of surpluses) {
        const use = Math.min(need, s.amount);
        s.amount -= use;
        need -= use;
        if (need <= EPS) break;
      }
      surpluses = surpluses.filter((s) => s.amount > EPS);
      if (need > EPS) deficits.push({ amount: need, until });
    }
  }

  expire(now.getTime());
  const sum = (lots: Lot[]) => round2(lots.reduce((a, l) => a + l.amount, 0));
  const soonest = (lots: Lot[]) =>
    lots.length ? dateKey(new Date(Math.min(...lots.map((l) => l.until)))) : null;
  return {
    bankedHours: sum(surpluses),
    bankedUntil: soonest(surpluses),
    owedHours: sum(deficits),
    owedUntil: soonest(deficits),
    unmetHours: round2(unmet),
  };
}

export type WfhPlan =
  | { enabled: false }
  | {
      enabled: true;
      expectedPerWeek: number;
      /** The week in progress: hours so far vs the target. */
      thisWeek: { weekStart: string; worked: number; target: number };
      /** The last few completed weeks, newest first. */
      recent: WfhWeek[];
      balance: WfhBalance;
    };

const HORIZON_DAYS = 120;

/** An employee's WFH-hours position. `enabled: false` when Admin hasn't set a
 *  target (or they're on a fixed full-time schedule, where it doesn't apply). */
export async function getWfhPlan(employeeId: string): Promise<WfhPlan> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      expectedWfhHoursPerWeek: true,
      expectedWfhHoursSince: true,
      dateOfJoining: true,
      employmentType: true,
    },
  });
  const target = employee?.expectedWfhHoursPerWeek == null ? 0 : Number(employee.expectedWfhHoursPerWeek);
  if (!employee || target <= 0 || employee.employmentType === "fulltime") return { enabled: false };

  const today = todayDateOnly();
  const thisWeekStart = weekStartOf(today);
  const horizon = addDays(thisWeekStart, -Math.ceil(HORIZON_DAYS / 7) * 7);
  // The week someone joins in is partial, so they're measured from the next one.
  // Measured from the first FULL week on/after both the joining date and the day
  // the target was set — a target switched on today must not charge for weeks
  // that had none.
  const firstFullWeekOnOrAfter = (d: Date) => {
    const w = weekStartOf(d);
    return w.getTime() === d.getTime() ? w : addDays(w, 7);
  };
  const since = employee.expectedWfhHoursSince;
  const floor = since && since > employee.dateOfJoining ? since : employee.dateOfJoining;
  const firstFull = firstFullWeekOnOrAfter(floor);
  const start = firstFull > horizon ? firstFull : horizon;

  const records = await prisma.attendanceRecord.findMany({
    where: {
      employeeId,
      approvalStatus: "approved",
      date: { gte: start, lt: addDays(thisWeekStart, 7) },
    },
    select: {
      date: true,
      workLocation: true,
      totalHours: true,
      sessions: { select: { clockIn: true, clockOut: true, workLocation: true } },
    },
  });

  const byWeek = new Map<string, number>();
  for (const r of records) {
    const wfh = splitHoursByLocation(r.totalHours === null ? null : Number(r.totalHours), r.sessions, r.workLocation).wfh;
    if (wfh <= 0) continue;
    const key = dateKey(weekStartOf(r.date));
    byWeek.set(key, (byWeek.get(key) ?? 0) + wfh);
  }

  const weeks: WfhWeekInput[] = [];
  for (let w = start; w <= thisWeekStart; w = addDays(w, 7)) {
    weeks.push({
      weekStart: w,
      worked: round2(byWeek.get(dateKey(w)) ?? 0),
      complete: w.getTime() < thisWeekStart.getTime(),
    });
  }

  const recent = weeks
    .filter((w) => w.complete)
    .slice(-4)
    .reverse()
    .map((w) => ({ weekStart: dateKey(w.weekStart), worked: w.worked, target, complete: true }));

  return {
    enabled: true,
    expectedPerWeek: target,
    thisWeek: {
      weekStart: dateKey(thisWeekStart),
      worked: round2(byWeek.get(dateKey(thisWeekStart)) ?? 0),
      target,
    },
    recent,
    balance: computeWfhBalance(weeks, target, today),
  };
}
