import { prisma } from "@/lib/db/prisma";
import { addDays, dateKey, weekStartOf } from "@/lib/attendance/week";
import { todayDateOnly } from "@/lib/attendance/time";
import { splitHoursByLocation } from "@/lib/attendance/calendar";
import { shiftHoursFor } from "@/lib/attendance/expected-hours";

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
//
// 2026-10-24 (owner request):
//  - WEEKLY CAP. At most `wfhWeeklyCapHours` (PayrollConfig, default 10) of a
//    week's WFH hours count — 15 worked still counts 10. The hours actually worked
//    are always kept and shown; an Admin can approve extra hours for a week
//    (WfhWeeklyApproval) so counted = min(actual, cap + extra).
//  - OFFICE COVERS WFH. A missed WFH hour can be made up later by working WFH OR
//    in the office, but a missed in-office day only in the office — so office
//    hours beyond a part-timer's in-office quota (days x shift) also cover a WFH
//    shortfall (and bank for 60 days like a WFH surplus). Office time is never
//    "owed" here: the in-office quota is days, handled by the attendance walk.

export const WFH_WINDOW_DAYS = 60;
const MS_PER_DAY = 86_400_000;
const EPS = 1e-9;

export const DEFAULT_WFH_WEEKLY_CAP_HOURS = 10;

/** Hours of a week's WFH work that count: all of it up to the cap, plus whatever
 *  extra an Admin approved (never more than was actually worked). Pure. */
export function countedWfhHours(actual: number, cap: number, approvedExtra = 0): number {
  const limit = cap + Math.max(0, approvedExtra);
  return round2(Math.max(0, Math.min(actual, limit)));
}

export type WfhWeekInput = {
  weekStart: Date;
  /** WFH hours that COUNT for the week (already capped). */
  worked: number;
  complete: boolean;
  /** Office hours beyond the week's in-office quota — they can cover a WFH
   *  shortfall like a WFH surplus. Optional; 0 when absent. */
  officeExtra?: number;
};

export type WfhWeek = {
  weekStart: string;
  /** Counted hours (after the cap + any Admin approval). */
  worked: number;
  /** Hours actually worked from home. */
  actual: number;
  cap: number;
  /** Extra hours an Admin approved over the cap for this week. */
  approvedExtra: number;
  target: number;
  complete: boolean;
};

export type WfhBalance = {
  /** Banked hours still usable against a shortfall. */
  bankedHours: number;
  /** The part of `bankedHours` that came from office time over the quota. */
  bankedFromOfficeHours: number;
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
  type Lot = { amount: number; until: number; kind: "wfh" | "office" };
  let surpluses: Lot[] = [];
  let deficits: { amount: number; until: number }[] = [];
  let unmet = 0;

  const expire = (at: number) => {
    surpluses = surpluses.filter((s) => s.until >= at);
    const still: typeof deficits = [];
    for (const d of deficits) {
      if (d.until < at) unmet += d.amount;
      else still.push(d);
    }
    deficits = still;
  };

  // Spend `amount` on the oldest open shortfalls; returns what is left over.
  const makeUp = (amount: number): number => {
    let left = amount;
    for (const d of deficits) {
      const use = Math.min(left, d.amount);
      d.amount -= use;
      left -= use;
      if (left <= EPS) break;
    }
    deficits = deficits.filter((d) => d.amount > EPS);
    return left;
  };

  for (const w of [...weeks].sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime())) {
    if (!w.complete) continue;
    const weekEnd = addDays(w.weekStart, 7).getTime();
    expire(weekEnd);
    const until = weekEnd + WFH_WINDOW_DAYS * MS_PER_DAY;
    const delta = w.worked - target;
    let officeExtra = Math.max(0, w.officeExtra ?? 0);

    if (delta > EPS) {
      // Worked over: first make up the oldest open shortfall, bank the rest.
      const left = makeUp(delta);
      if (left > EPS) surpluses.push({ amount: left, until, kind: "wfh" });
    } else if (delta < -EPS) {
      // Fell short: spend the oldest banked surplus first (WFH or office — a WFH
      // hour can be made up either way), then this week's own office extra; the
      // rest stays owed.
      let need = -delta;
      for (const s of surpluses) {
        const use = Math.min(need, s.amount);
        s.amount -= use;
        need -= use;
        if (need <= EPS) break;
      }
      surpluses = surpluses.filter((s) => s.amount > EPS);
      if (need > EPS) {
        const use = Math.min(need, officeExtra);
        officeExtra -= use;
        need -= use;
      }
      if (need > EPS) deficits.push({ amount: need, until });
    }

    // Whatever office time is left over makes up older shortfalls, then banks.
    if (officeExtra > EPS) {
      const left = makeUp(officeExtra);
      if (left > EPS) surpluses.push({ amount: left, until, kind: "office" });
    }
  }

  expire(now.getTime());
  const sum = (lots: { amount: number }[]) => round2(lots.reduce((a, l) => a + l.amount, 0));
  const soonest = (lots: { until: number }[]) =>
    lots.length ? dateKey(new Date(Math.min(...lots.map((l) => l.until)))) : null;
  return {
    bankedHours: sum(surpluses),
    bankedFromOfficeHours: sum(surpluses.filter((s) => s.kind === "office")),
    bankedUntil: soonest(surpluses),
    owedHours: sum(deficits),
    owedUntil: soonest(deficits),
    unmetHours: round2(unmet),
  };
}

/** One entry of PayrollConfig's cap history. */
export type WfhCapEntry = { effectiveFrom: Date; capHours: number };

/** The cap in force for a week: the latest config row effective on or before its
 *  Monday, or the default when none is. Pure. */
export function wfhCapForWeek(history: WfhCapEntry[], weekStart: Date): number {
  let cap = DEFAULT_WFH_WEEKLY_CAP_HOURS;
  let at = -Infinity;
  for (const h of history) {
    const t = h.effectiveFrom.getTime();
    if (t <= weekStart.getTime() && t >= at) {
      cap = h.capHours;
      at = t;
    }
  }
  return cap;
}

/** Cap history, oldest first (a later row wins a same-day tie). */
export async function loadWfhCapHistory(): Promise<WfhCapEntry[]> {
  const rows = await prisma.payrollConfig.findMany({
    orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }],
    select: { effectiveFrom: true, wfhWeeklyCapHours: true },
  });
  return rows.map((r) => ({ effectiveFrom: r.effectiveFrom, capHours: Number(r.wfhWeeklyCapHours) }));
}

/** The cap that applies to the week containing `date`. */
export async function getWfhWeeklyCap(date: Date): Promise<number> {
  return wfhCapForWeek(await loadWfhCapHistory(), weekStartOf(date));
}

export type WfhPlan =
  | { enabled: false }
  | {
      enabled: true;
      expectedPerWeek: number;
      /** The cap now in force (hours per week that count). */
      capPerWeek: number;
      /** The week in progress. `worked` is the COUNTED hours (after the cap and any
       *  Admin approval), `actual` what was really worked from home. */
      thisWeek: {
        weekStart: string;
        worked: number;
        actual: number;
        cap: number;
        approvedExtra: number;
        target: number;
      };
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
      requiredDaysPerWeek: true,
      team: { select: { expectedStartTime: true, expectedEndTime: true } },
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

  const [capHistory, approvals] = await Promise.all([
    loadWfhCapHistory(),
    prisma.wfhWeeklyApproval.findMany({
      where: { employeeId, weekStart: { gte: start, lte: thisWeekStart } },
      select: { weekStart: true, extraHours: true },
    }),
  ]);
  const extraByWeek = new Map(approvals.map((a) => [dateKey(a.weekStart), Number(a.extraHours)]));
  // Office time that can cover a WFH shortfall: hours beyond the in-office quota.
  const officeQuotaHours =
    employee.requiredDaysPerWeek && employee.requiredDaysPerWeek > 0
      ? employee.requiredDaysPerWeek * shiftHoursFor(employee.team?.expectedStartTime, employee.team?.expectedEndTime)
      : null;

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

  const wfhByWeek = new Map<string, number>();
  const officeByWeek = new Map<string, number>();
  for (const r of records) {
    const split = splitHoursByLocation(r.totalHours === null ? null : Number(r.totalHours), r.sessions, r.workLocation);
    const key = dateKey(weekStartOf(r.date));
    if (split.wfh > 0) wfhByWeek.set(key, (wfhByWeek.get(key) ?? 0) + split.wfh);
    if (split.office > 0) officeByWeek.set(key, (officeByWeek.get(key) ?? 0) + split.office);
  }

  const detail = (w: Date): WfhWeek => {
    const key = dateKey(w);
    const actual = round2(wfhByWeek.get(key) ?? 0);
    const cap = wfhCapForWeek(capHistory, w);
    const approvedExtra = extraByWeek.get(key) ?? 0;
    return {
      weekStart: key,
      worked: countedWfhHours(actual, cap, approvedExtra),
      actual,
      cap,
      approvedExtra,
      target,
      complete: w.getTime() < thisWeekStart.getTime(),
    };
  };

  const weeks: WfhWeekInput[] = [];
  for (let w = start; w <= thisWeekStart; w = addDays(w, 7)) {
    const d = detail(w);
    weeks.push({
      weekStart: w,
      worked: d.worked,
      complete: d.complete,
      officeExtra:
        officeQuotaHours === null ? 0 : round2(Math.max(0, (officeByWeek.get(dateKey(w)) ?? 0) - officeQuotaHours)),
    });
  }

  const recent = weeks
    .filter((w) => w.complete)
    .slice(-4)
    .reverse()
    .map((w) => detail(w.weekStart));

  const current = detail(thisWeekStart);
  return {
    enabled: true,
    expectedPerWeek: target,
    capPerWeek: current.cap,
    thisWeek: {
      weekStart: current.weekStart,
      worked: current.worked,
      actual: current.actual,
      cap: current.cap,
      approvedExtra: current.approvedExtra,
      target,
    },
    recent,
    balance: computeWfhBalance(weeks, target, today),
  };
}

/** WFH hours actually worked (approved days only) in the ISO week containing
 *  `date` — what an Admin is looking at when deciding whether to approve more. */
export async function getActualWfhHoursForWeek(employeeId: string, date: Date): Promise<number> {
  const weekStart = weekStartOf(date);
  const records = await prisma.attendanceRecord.findMany({
    where: { employeeId, approvalStatus: "approved", date: { gte: weekStart, lt: addDays(weekStart, 7) } },
    select: {
      workLocation: true,
      totalHours: true,
      sessions: { select: { clockIn: true, clockOut: true, workLocation: true } },
    },
  });
  return round2(
    records.reduce(
      (sum, r) =>
        sum + splitHoursByLocation(r.totalHours === null ? null : Number(r.totalHours), r.sessions, r.workLocation).wfh,
      0,
    ),
  );
}
