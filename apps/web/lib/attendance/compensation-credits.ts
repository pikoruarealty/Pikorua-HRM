import { AttendanceApprovalStatus, Prisma, RequestStatus, RequestType, WorkLocation } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

/** Either the default prisma singleton or an interactive-transaction client
 *  (tx) — lets commit/rollback run inside the same transaction as the
 *  payslip write that depends on them. */
type Db = typeof prisma | Prisma.TransactionClient;
import { addDays, weekStartOf } from "@/lib/attendance/week";
import {
  getMonthlyAttendanceBreakdown,
  getMonthlyAttendanceWithLedger,
  type ClassifiedDay,
  type MonthlyBreakdown,
} from "@/lib/attendance/monthly-breakdown";
import { isFixedSchedule } from "@/lib/attendance/weekly-off";
import { getWeekOff } from "@/lib/attendance/weekly-off";
import { periodBounds } from "@/lib/requests/leave-math";
import { splitHoursByLocation } from "@/lib/attendance/calendar";
import { EXTRA_DAY_RULE_FROM, pickBankedDay, type MissedUnit, type Place } from "@/lib/attendance/extra-days";
import { todayDateOnly } from "@/lib/attendance/time";

// Compensation credit (comp-off) ledger, 2026-09-06 owner request: "if I come
// on my weekoff, then it should compensate for my leaves in the timeframe of
// 60 days and reflect in current month's payslip." Design decisions below are
// mine (delegated by the owner) — flagged in progress.md, not silently
// assumed:
//
// 1. A credit is issued the moment an attendance record both (a) qualifies as
//    a compensation day — an off-day clock-in (fixed-schedule employees
//    only, see isFlexible below) or an Admin/HR manual isCompensation flag —
//    AND (b) is approved. Payroll's whole day-classification pipeline
//    (monthly-breakdown.ts) only ever reads approved records, so gating
//    issuance the same way keeps a credit from existing for a day that
//    doesn't count as worked yet (and can still be rejected/edited away).
// 2. Redemption window is [earnedDate, earnedDate + 60 days] inclusive — the
//    credit compensates a leave taken ON OR AFTER the day it was earned, not
//    retroactively before it. This is the standard "comp-off" reading (earn,
//    then spend) and matches the schema's `expiresAt` framing.
// 3. Flexible-schedule employees (part-time/intern with requiredDaysPerWeek)
//    are scoped OUT of automatic off-day issuance: their comp days are a
//    weekly-aggregate overflow (monthly-breakdown.ts's isFlexible branch)
//    with no single record to anchor a credit to. The manual isCompensation
//    override still applies to them, since that's an explicit per-record
//    Admin/HR decision.
// 4. Redemption feeds lib/payroll/payslip-preview.ts (adjusts
//    paidLeaveDays/absentDays/unpaidLeaveDays before computeEarnedBasePay).
//
// Absence-first redemption (2026-09-18, owner request — "compensation should
// firstly compensate for the absent days, and then if the absent days are
// completed, then only add them to the leave balance, not directly"):
// 5. A credit's window covers a combined pool of unpaid days: plain
//    no-record absences (MonthlyBreakdown.absentDates, fixed-schedule
//    employees only — see isFlexible in classifyMonth) AND approved
//    leave_unpaid request days. Plain absences are matched first (oldest
//    first), then leftover credits match unpaid-leave-request days — so an
//    employee who came in early (earning a credit) and was later absent
//    without filing anything still gets covered, per the owner's "someone
//    came in advance and then not came in" example.
// 6. lib/leave/balance.ts no longer adds every compensation day straight
//    onto the leave balance. A credit only tops up the balance once it
//    expires having covered nothing at all in its 60-day life — see
//    getExpiredUnusedCreditCount below. A credit that redeemed an absence or
//    an unpaid-leave day never adds to the balance; it already did its job.

// Where the work happened matters (2026-10-24, owner rule): "in-office days can be
// compensated in office only, but WFH can be compensated both ways, in office and
// WFH later too."
// 8. (2026-10-24) A credit can also be USED ON PURPOSE for one specific day —
//    POST /attendance/balance-day by the employee (or Admin/HR) — instead of waiting
//    for a payslip to redeem it. That sets consumed_at / consumed_for_date like a
//    redemption and `applied = true`; attendance then counts the day as covered
//    straight away (monthly-breakdown.ts `balanceDates`). Same eligibility as
//    point 7 (window, office/WFH rule); only a whole absent / unpaid-leave day of a
//    fixed-schedule employee, already over, in a month with no payslip yet.
// 7. Each credit carries the location of the day that earned it. A day to be
//    covered is an IN-OFFICE day unless an approved work-from-home request covers
//    it (then it is a WFH day). An OFFICE credit covers either kind of day; a WFH
//    credit covers only a WFH day — so a day owed in the office can only be made up
//    by working in the office. When both could cover a WFH day, the WFH credit is
//    spent first so the more flexible office credit stays available.
//
// 2026-11-01 — the make-up rule (lib/attendance/extra-days.ts) replaces points 1, 4,
// 5 and 6 for extra days on/after EXTRA_DAY_RULE_FROM. A balance day is no longer a
// row minted when a record is approved — that missed every biometric day, whose
// records are approved by the device sync and never went through here — it is
// DERIVED from attendance by the walk's ledger, so it exists exactly when the walk
// says the day was banked. A row is written only when a balance day is USED (an
// approved balance_day request: `applied`). Payslips no longer redeem credits on
// their own for those months: compensation and balance days are already in the
// walk's counts. Rows for earlier days keep the old behaviour.

export const COMPENSATION_CREDIT_WINDOW_DAYS = 60;

/** Is this day under the make-up rule (no automatic credit rows / redemption)? */
export function underExtraDayRule(date: Date): boolean {
  return date.toISOString().slice(0, 10) >= EXTRA_DAY_RULE_FROM;
}
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The one rule: may a credit earned at `credit` cover a day that was owed at
 *  `day`? Office covers anything; WFH covers only a WFH day. */
export function canCreditCover(credit: WorkLocation, day: WorkLocation): boolean {
  return credit === WorkLocation.office || day === WorkLocation.wfh;
}

/** Where an attendance record was worked, for the credit it earns: WFH only when
 *  the whole day was from home. A day with any office time is an office day (the
 *  more valuable kind). A record with no session detail falls back to its own
 *  recorded location. */
export function creditLocationOf(record: {
  totalHours: unknown;
  workLocation: WorkLocation;
  sessions: { clockIn: Date; clockOut: Date | null; workLocation: WorkLocation }[];
}): WorkLocation {
  const split = splitHoursByLocation(
    record.totalHours === null || record.totalHours === undefined ? null : Number(record.totalHours),
    record.sessions,
    record.workLocation,
  );
  if (split.office > 0) return WorkLocation.office;
  if (split.wfh > 0) return WorkLocation.wfh;
  return record.workLocation;
}

/** Re-derives whether an attendance record currently qualifies for a
 *  compensation credit and creates/removes the credit row to match. Called
 *  after any write that could change qualification: approve, the manual
 *  is_compensation edit, and the pre-approved manual/manual-bulk entry
 *  routes. Idempotent — safe to call whether or not anything changed. */
export async function syncCompensationCreditForRecord(recordId: string): Promise<void> {
  const record = await prisma.attendanceRecord.findUnique({
    where: { id: recordId },
    select: { employeeId: true, date: true },
  });
  if (!record) return;
  await syncCompensationCreditsForWeek(record.employeeId, record.date);
}

/** Re-syncs every attendance record's credit in the ISO week containing `date`.
 *
 *  Whole-week, not per-record, since 2026-09-30: whether a worked day is a
 *  compensation day now depends on the rest of its week — if the employee
 *  worked their default off day but skipped another day, that other day is the
 *  week's off and the default day is an ordinary workday (see
 *  lib/attendance/weekly-off.ts). Approving, editing or deleting ANY record in
 *  the week, or changing a leave/unpaid-day declaration, can flip that, so the
 *  whole week is re-derived. Idempotent. */
export async function syncCompensationCreditsForWeek(employeeId: string, date: Date): Promise<void> {
  const weekStart = weekStartOf(date);
  const weekEnd = addDays(weekStart, 7);

  const [records, weekOff] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: { employeeId, date: { gte: weekStart, lt: weekEnd } },
      select: {
        id: true,
        date: true,
        approvalStatus: true,
        isCompensation: true,
        clockInApproved: true,
        clockInRaw: true,
        totalHours: true,
        workLocation: true,
        sessions: { select: { clockIn: true, clockOut: true, workLocation: true } },
      },
    }),
    getWeekOff(employeeId, weekStart),
  ]);

  for (const record of records) {
    const hasClockIn = !!(record.clockInApproved ?? record.clockInRaw);
    const isApproved = record.approvalStatus === AttendanceApprovalStatus.approved;

    // weekOff is null for a flexible-schedule employee (part-time/intern on a
    // days-per-week quota): they get no automatic off-day credit, only the
    // explicit Admin/HR isCompensation flag.
    const qualifies =
      isApproved &&
      hasClockIn &&
      (record.isCompensation || (weekOff !== null && weekOff.date === record.date.toISOString().slice(0, 10)));

    const existingCredit = await prisma.compensationCredit.findUnique({
      where: { sourceRecordId: record.id },
      select: { id: true, consumedAt: true, workLocation: true },
    });

    // Under the make-up rule a balance day is derived from attendance, not stored:
    // only a USED one has a row. A leftover unused row (minted before the rule
    // shipped) is dropped so nothing counts it twice.
    if (underExtraDayRule(record.date)) {
      if (existingCredit && !existingCredit.consumedAt) {
        await prisma.compensationCredit.delete({ where: { id: existingCredit.id } });
      }
      continue;
    }

    if (qualifies) {
      const workLocation = creditLocationOf(record);
      if (!existingCredit) {
        await prisma.compensationCredit.create({
          data: {
            employeeId,
            earnedDate: record.date,
            expiresAt: new Date(record.date.getTime() + COMPENSATION_CREDIT_WINDOW_DAYS * MS_PER_DAY),
            sourceRecordId: record.id,
            workLocation,
          },
        });
      } else if (!existingCredit.consumedAt && existingCredit.workLocation !== workLocation) {
        // The day was edited (e.g. re-tagged office/WFH) after the credit was
        // minted. A credit a payslip already spent keeps the location it was spent as.
        await prisma.compensationCredit.update({ where: { id: existingCredit.id }, data: { workLocation } });
      }
      continue;
    }

    // No longer qualifies (e.g. the manual flag was unset, or the week's off
    // moved to another day). A credit already consumed by a generated payslip is
    // left alone — unwinding it would need to also touch the payslip that
    // consumed it, which this sync has no knowledge of.
    if (existingCredit && !existingCredit.consumedAt) {
      await prisma.compensationCredit.delete({ where: { id: existingCredit.id } });
    }
  }
}

/** Week-by-week re-sync over an inclusive date range — for changes that aren't
 *  tied to one record (an approved leave covering several days, an unpaid-day
 *  declaration). */
export async function syncCompensationCreditsForRange(employeeId: string, from: Date, to: Date): Promise<void> {
  const last = weekStartOf(to).getTime();
  for (let w = weekStartOf(from).getTime(); w <= last; w += 7 * MS_PER_DAY) {
    await syncCompensationCreditsForWeek(employeeId, new Date(w));
  }
}

export type CompensationRedemption = {
  creditId: string;
  date: Date;
  /** Which pool the redeemed day came from — absences are matched first. */
  kind: "absence" | "unpaid_leave";
  /** The Request row the day belongs to; null for a plain absence (there is
   *  no request — see consumedForRequestId's nullability in schema.prisma). */
  requestId: string | null;
};

async function getUnpaidLeaveDaysInPeriod(
  employeeId: string,
  month: number,
  year: number,
  /** The days the month's walk actually counts as a whole unpaid day. A request
   *  can cover a day the walk does not count as unpaid (a weekly off, a holiday,
   *  a day worked in full), and redeeming one of those would pay a day that was
   *  never deducted. */
  countedUnpaidDays: Set<string>,
): Promise<{ date: Date; requestId: string | null }[]> {
  const { start: periodStart, lastDay: periodLastDay } = periodBounds(month, year);
  const [requests, declared] = await Promise.all([
    prisma.request.findMany({
      where: {
        employeeId,
        type: RequestType.leave_unpaid,
        status: RequestStatus.approved,
        // A half-day unpaid leave is not redeemable: a credit covers whole days
        // (2026-10-01). An unused credit isn't lost — it tops up the leave balance
        // once it expires (see getExpiredUnusedCreditCount).
        halfDay: false,
        dateFrom: { lte: periodLastDay },
        dateTo: { gte: periodStart },
      },
      select: { id: true, dateFrom: true, dateTo: true },
    }),
    // Days the employee switched from a weekly off to unpaid themselves — an
    // unpaid day like any other, so a credit can cover it (no request row).
    prisma.unpaidDayDeclaration.findMany({
      where: { employeeId, date: { gte: periodStart, lte: periodLastDay } },
      select: { date: true },
    }),
  ]);

  const days: { date: Date; requestId: string | null }[] = declared
    .filter((d) => countedUnpaidDays.has(d.date.toISOString().slice(0, 10)))
    .map((d) => ({ date: d.date, requestId: null }));
  const seen = new Set(days.map((d) => d.date.toISOString().slice(0, 10)));
  for (const r of requests) {
    if (!r.dateFrom || !r.dateTo) continue;
    const start = r.dateFrom < periodStart ? periodStart : r.dateFrom;
    const end = r.dateTo > periodLastDay ? periodLastDay : r.dateTo;
    for (let t = start.getTime(); t <= end.getTime(); t += MS_PER_DAY) {
      const key = new Date(t).toISOString().slice(0, 10);
      // One redeemable day per date, and only if the walk counted it unpaid.
      if (!countedUnpaidDays.has(key) || seen.has(key)) continue;
      seen.add(key);
      days.push({ date: new Date(t), requestId: r.id });
    }
  }
  return days;
}

/** Plain no-record absences (MonthlyBreakdown.absentDates) for the month —
 *  fixed-schedule employees only, same scope as automatic credit issuance
 *  (see point 3 above). */
function absentDaysOf(breakdown: Awaited<ReturnType<typeof getMonthlyAttendanceBreakdown>>): { date: Date }[] {
  return breakdown.absentDates.map((date) => ({ date }));
}

/** The dates the month's walk counts as one whole unpaid-leave day. */
function wholeUnpaidDaysOf(breakdown: Awaited<ReturnType<typeof getMonthlyAttendanceBreakdown>>): Set<string> {
  return new Set(
    breakdown.days.filter((d) => d.status === "unpaid_leave" && d.leaveUnpaid === 1).map((d) => d.date),
  );
}

/** Pure allocator (unit-testable without a DB): greedily matches each day,
 *  oldest first, against the unconsumed credit that covers it and expires
 *  soonest — so no credit is left idle while an earlier one expires unused.
 *  Absence days are matched in full before any unpaid-leave day is
 *  considered, per the owner's "compensate for absent days first" ordering
 *  — only credits left over after absences are exhausted can cover leave.
 *  Each credit and each day is used at most once.
 *
 *  Location (point 7 above): a day without `location` is an in-office day, a
 *  credit without `workLocation` an office credit — so callers and tests that
 *  predate the rule behave exactly as before. */
export function allocateCompensationCredits(
  absenceDays: { date: Date; location?: WorkLocation }[],
  unpaidLeaveDays: { date: Date; requestId: string | null; location?: WorkLocation }[],
  credits: { id: string; earnedDate: Date; expiresAt: Date; workLocation?: WorkLocation }[],
): CompensationRedemption[] {
  if (credits.length === 0 || (absenceDays.length === 0 && unpaidLeaveDays.length === 0)) return [];

  const sortedCredits = [...credits].sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  const usedCreditIds = new Set<string>();
  const redemptions: CompensationRedemption[] = [];

  const allocate = <T extends { date: Date; location?: WorkLocation }>(
    days: T[],
    kind: CompensationRedemption["kind"],
    requestIdOf: (day: T) => string | null,
  ) => {
    const sortedDays = [...days].sort((a, b) => a.date.getTime() - b.date.getTime());
    for (const day of sortedDays) {
      const dayLocation = day.location ?? WorkLocation.office;
      const eligible = sortedCredits.filter(
        (c) =>
          !usedCreditIds.has(c.id) &&
          c.earnedDate.getTime() <= day.date.getTime() &&
          day.date.getTime() <= c.expiresAt.getTime() &&
          canCreditCover(c.workLocation ?? WorkLocation.office, dayLocation),
      );
      // For a WFH day, spend a WFH credit first: an office credit can cover an
      // in-office day too, so it is the one worth keeping.
      const match =
        dayLocation === WorkLocation.wfh
          ? (eligible.find((c) => c.workLocation === WorkLocation.wfh) ?? eligible[0])
          : eligible[0];
      if (match) {
        usedCreditIds.add(match.id);
        redemptions.push({ creditId: match.id, date: day.date, kind, requestId: requestIdOf(day) });
      }
    }
  };

  allocate(absenceDays, "absence", () => null);
  allocate(unpaidLeaveDays, "unpaid_leave", (day) => day.requestId);

  return redemptions;
}

/** Dates in [start, end] covered by an APPROVED work-from-home request — the days
 *  an employee was expected to work from home, which a credit of either location
 *  can cover. A request without a date range covers nothing here. */
export async function loadWfhRequestDates(employeeId: string, start: Date, end: Date): Promise<Set<string>> {
  const requests = await prisma.request.findMany({
    where: {
      employeeId,
      type: RequestType.wfh,
      status: RequestStatus.approved,
      dateFrom: { lte: end },
      dateTo: { gte: start },
    },
    select: { dateFrom: true, dateTo: true },
  });
  const dates = new Set<string>();
  for (const r of requests) {
    if (!r.dateFrom || !r.dateTo) continue;
    const from = r.dateFrom < start ? start : r.dateFrom;
    const to = r.dateTo > end ? end : r.dateTo;
    for (let t = from.getTime(); t <= to.getTime(); t += MS_PER_DAY) dates.add(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}

/** Dry-run: which absent/approved-unpaid-leave days in this month WOULD be
 *  redeemed against this employee's unconsumed compensation credits.
 *  Read-only — does not touch consumedAt. Used by payslip-preview.ts (both
 *  the live preview and as the exact list generate/recompute commit
 *  transactionally, so what the user previewed is exactly what gets
 *  persisted). */
export async function computeCompensationRedemption(
  employeeId: string,
  month: number,
  year: number,
): Promise<CompensationRedemption[]> {
  const { start: periodStart, lastDay: periodLastDay } = periodBounds(month, year);
  // Under the make-up rule the walk already pays every make-up and every used
  // balance day; redeeming on top would pay the same extra day twice.
  if (underExtraDayRule(new Date(Date.UTC(year, month, 0)))) return [];
  const [breakdown, credits, wfhDates] = await Promise.all([
    getMonthlyAttendanceBreakdown(employeeId, month, year),
    prisma.compensationCredit.findMany({
      where: { employeeId, consumedAt: null },
      select: { id: true, earnedDate: true, expiresAt: true, workLocation: true },
    }),
    loadWfhRequestDates(employeeId, periodStart, periodLastDay),
  ]);
  const unpaidDays = await getUnpaidLeaveDaysInPeriod(employeeId, month, year, wholeUnpaidDaysOf(breakdown));

  const locate = <T extends { date: Date }>(day: T): T & { location: WorkLocation } => ({
    ...day,
    location: wfhDates.has(day.date.toISOString().slice(0, 10)) ? WorkLocation.wfh : WorkLocation.office,
  });
  return allocateCompensationCredits(absentDaysOf(breakdown).map(locate), unpaidDays.map(locate), credits);
}

/** Commits a redemption list computed by computeCompensationRedemption —
 *  called only from the routes that actually persist a payslip (generate,
 *  recompute), never from preview. Guards on consumedAt: null so a credit
 *  already spent since the dry-run silently isn't double-spent. */
export async function commitCompensationRedemptions(
  redemptions: CompensationRedemption[],
  db: Db = prisma,
): Promise<void> {
  if (redemptions.length === 0) return;
  await Promise.all(
    redemptions.map((r) =>
      db.compensationCredit.updateMany({
        where: { id: r.creditId, consumedAt: null },
        data: { consumedAt: new Date(), consumedForDate: r.date, consumedForRequestId: r.requestId },
      }),
    ),
  );
}

export type CompensationCreditSummary = { activeCount: number; nearestExpiry: Date | null };

/** Balance days that can actually be used: unspent, unexpired, and earned in the
 *  office. A WFH-earned one only covers a day owed from home (an approved WFH
 *  request), and those can't be filed in the app, so it covers nothing today — it
 *  is listed, but not counted as available. */
export function usableBalanceCount(bank: { status: string; location: string }[]): number {
  return bank.filter((b) => b.status === "available" && b.location === "office").length;
}

/** Usable balance-day count + nearest expiry for one employee — surfaced in the
 *  leave balance panel (GET /leave-config/balance) so an employee can see they've
 *  earned one and by when to use it. From the walk's ledger (derived, see above). */
export async function getCompensationCreditSummary(employeeId: string): Promise<CompensationCreditSummary> {
  const now = new Date();
  const { ledger } = await getMonthlyAttendanceWithLedger(employeeId, now.getMonth() + 1, now.getFullYear(), now);
  const open = ledger.bank
    .filter((b) => b.status === "available" && b.location === "office")
    .sort((a, b) => (a.expires < b.expires ? -1 : 1));
  return {
    activeCount: open.length,
    nearestExpiry: open[0] ? new Date(`${open[0].expires}T00:00:00.000Z`) : null,
  };
}

export type BalanceCredit = {
  id: string;
  earnedDate: string;
  expiresAt: string;
  workLocation: WorkLocation;
  /** available: unspent and usable; used: spent on `coversDate` through an approved
   *  balance-day request; expired: lapsed unused (it tops up the leave balance). */
  status: "available" | "used" | "expired";
  coversDate?: string;
  /** Spent through an approved request (always true for `used`). */
  applied?: boolean;
};

/** A day a balance day could be used on: over, nothing worked or paid on it, not
 *  already made up by a later extra day. */
export type BalanceEligibleDay = {
  date: string;
  kind: "absence" | "unpaid_leave";
  location: WorkLocation;
  /** A balance-day request for this day is already waiting for Admin/HR. */
  pending: boolean;
};

/** A make-up that touches the month asked about: an extra day this month that made
 *  up a missed day (maybe last month's), or a missed day this month made up later. */
export type MadeUpEntry = {
  /** The extra day that did the making up. */
  on: string;
  /** The missed day (for a part-timer's quota shortfall, the end of its week). */
  missedDate: string;
  missedKind: MissedUnit["kind"];
  /** Set for a part-timer's quota shortfall: the week it was in. */
  weekStart?: string;
};

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Which days of this month a balance day could be used on, by the walk. A fixed
 * schedule: whole absent / unpaid-leave days. A part-timer's absence is a weekly
 * quota shortfall with no date, so a day of theirs that was not worked, in a week
 * left short (and owned by this month), stands in for one shortfall day each.
 * Days a later extra day already made up are left out — they are paid there.
 */
export function eligibleBalanceDays(
  breakdown: Pick<MonthlyBreakdown, "days" | "missedUnits" | "madeUp">,
  fixedSchedule: boolean,
  todayKey: string,
): { date: string; kind: "absence" | "unpaid_leave" }[] {
  const madeUp = new Set(breakdown.madeUp.map((m) => m.missed.id));
  const out: { date: string; kind: "absence" | "unpaid_leave" }[] = [];
  const isOpenMissed = (d: ClassifiedDay) => d.date < todayKey && !d.madeUpOn;
  if (fixedSchedule) {
    for (const d of breakdown.days) {
      if (!isOpenMissed(d) || (d.absentPart ?? 0) > 0) continue;
      if (d.status === "absent") out.push({ date: d.date, kind: "absence" });
      else if (d.status === "unpaid_leave" && d.leaveUnpaid === 1) out.push({ date: d.date, kind: "unpaid_leave" });
    }
    return out;
  }
  // Part-timer: one not-worked day per open shortfall day, in that week and month.
  const openByWeek = new Map<string, number>();
  for (const u of breakdown.missedUnits) {
    if (u.kind !== "shortfall" || !u.weekStart || madeUp.has(u.id)) continue;
    openByWeek.set(u.weekStart, (openByWeek.get(u.weekStart) ?? 0) + 1);
  }
  const month = breakdown.days[0]?.date.slice(0, 7);
  for (const d of breakdown.days) {
    if (d.status !== "no_record" || d.date >= todayKey || d.date.slice(0, 7) !== month) continue;
    const wk = dayKey(weekStartOf(new Date(`${d.date}T00:00:00.000Z`)));
    const left = openByWeek.get(wk) ?? 0;
    if (left <= 0) continue;
    openByWeek.set(wk, left - 1);
    out.push({ date: d.date, kind: "absence" });
  }
  for (const d of breakdown.days) {
    if (isOpenMissed(d) && d.status === "unpaid_leave" && d.leaveUnpaid === 1) {
      out.push({ date: d.date, kind: "unpaid_leave" });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** The make-ups that touch this month, for the attendance panel and the PDF. */
export function madeUpEntries(breakdown: Pick<MonthlyBreakdown, "days" | "madeUp">): MadeUpEntry[] {
  const out: MadeUpEntry[] = [];
  const seen = new Set<string>();
  for (const d of breakdown.days) {
    if (d.status !== "compensation" || !d.madeUpFor) continue;
    seen.add(`${d.date}|${d.madeUpFor.date}`);
    out.push({
      on: d.date,
      missedDate: d.madeUpFor.date,
      missedKind: d.madeUpFor.kind,
      ...(d.madeUpFor.weekStart ? { weekStart: d.madeUpFor.weekStart } : {}),
    });
  }
  for (const m of breakdown.madeUp) {
    if (seen.has(`${m.on}|${m.missed.date}`)) continue;
    out.push({
      on: m.on,
      missedDate: m.missed.date,
      missedKind: m.missed.kind,
      ...(m.missed.weekStart ? { weekStart: m.missed.weekStart } : {}),
    });
  }
  return out.sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));
}

/** The employee's balance days for display (newest first, recent ones), the days of
 *  `month` one could be used on right now (`eligibleDays`) and the make-ups that
 *  touch the month. All from the walk's ledger, so the card can't disagree with the
 *  calendar. */
export async function getCompensationBalance(
  employeeId: string,
  month: number,
  year: number,
  now: Date = new Date(),
): Promise<{
  availableCount: number;
  credits: BalanceCredit[];
  eligibleDays: BalanceEligibleDay[];
  madeUp: MadeUpEntry[];
}> {
  const { start: periodStart, lastDay: periodLastDay } = periodBounds(month, year);
  const [{ breakdown, ledger }, employee, wfhDates, payslip, pendingRequests] = await Promise.all([
    getMonthlyAttendanceWithLedger(employeeId, month, year, now),
    prisma.employee.findUnique({
      where: { id: employeeId },
      select: { employmentType: true, requiredDaysPerWeek: true },
    }),
    loadWfhRequestDates(employeeId, periodStart, periodLastDay),
    prisma.payslip.findUnique({
      where: { employeeId_periodYear_periodMonth: { employeeId, periodYear: year, periodMonth: month } },
      select: { id: true },
    }),
    prisma.request.findMany({
      where: {
        employeeId,
        type: RequestType.balance_day,
        status: RequestStatus.pending,
        dateFrom: { gte: periodStart, lte: periodLastDay },
      },
      select: { dateFrom: true },
    }),
  ]);
  const pendingDates = new Set(pendingRequests.flatMap((r) => (r.dateFrom ? [dayKey(r.dateFrom)] : [])));
  const todayKey = dayKey(todayDateOnly());
  // Recent history only: anything still usable, plus what lapsed or was used lately.
  const since = dayKey(new Date(now.getTime() - 120 * MS_PER_DAY));

  const credits: BalanceCredit[] = [...ledger.bank]
    .filter((b) => b.status === "available" || b.date >= since)
    .reverse()
    .map((b) => ({
      id: `bank-${b.date}`,
      earnedDate: b.date,
      expiresAt: b.expires,
      workLocation: b.location as WorkLocation,
      status: b.status,
      ...(b.usedFor ? { coversDate: b.usedFor, applied: true } : {}),
    }));

  const eligibleDays: BalanceEligibleDay[] = [];
  if (employee && !payslip) {
    for (const d of eligibleBalanceDays(breakdown, isFixedSchedule(employee), todayKey)) {
      const place: Place = wfhDates.has(d.date) ? "wfh" : "office";
      if (!pickBankedDay(ledger.bank, d.date, place)) continue;
      eligibleDays.push({ ...d, location: place as WorkLocation, pending: pendingDates.has(d.date) });
    }
  }

  return {
    availableCount: usableBalanceCount(ledger.bank),
    credits,
    eligibleDays,
    madeUp: madeUpEntries(breakdown),
  };
}

/** Balance days that expired having covered nothing in their 60 days, with the
 *  expiry inside [start, end]. These are the only ones that top up
 *  lib/leave/balance.ts's leave balance — see point 6 above: a credit that redeemed
 *  an absence or unpaid-leave day already did its job and never also adds to the
 *  balance. Rows from before the make-up rule are counted as before; from the rule
 *  on they come from the walk's ledger (an extra day that made up a missed day was
 *  never banked, so it never lapses into leave). */
export async function getExpiredUnusedCreditCount(
  employeeId: string,
  start: Date,
  end: Date,
): Promise<number> {
  const now = new Date();
  const ruleDate = new Date(`${EXTRA_DAY_RULE_FROM}T00:00:00.000Z`);
  const [legacy, { ledger }] = await Promise.all([
    prisma.compensationCredit.count({
      where: {
        employeeId,
        consumedAt: null,
        earnedDate: { lt: ruleDate },
        expiresAt: { gte: start, lte: end, lt: now },
      },
    }),
    getMonthlyAttendanceWithLedger(employeeId, now.getMonth() + 1, now.getFullYear(), now),
  ]);
  const from = dayKey(start);
  const to = dayKey(end);
  const derived = ledger.bank.filter((b) => b.status === "expired" && b.expires >= from && b.expires <= to).length;
  return legacy + derived;
}

/** Un-commits every credit this employee's payslip for the given period
 *  consumed — called when a draft payslip is deleted, so the credits go back
 *  into the pool instead of being silently burned with no way to redeem them
 *  again on a subsequent regenerate. Identifies them by consumedForDate
 *  falling inside the period, since redemption only ever allocates dates
 *  strictly within the month being processed. */
export async function rollbackCompensationRedemptionsForPeriod(
  employeeId: string,
  month: number,
  year: number,
  db: Db = prisma,
): Promise<void> {
  const { start: periodStart, lastDay: periodLastDay } = periodBounds(month, year);
  await db.compensationCredit.updateMany({
    // `applied` credits were used on purpose for a specific day — a payslip being
    // deleted must not give those back.
    where: { employeeId, applied: false, consumedForDate: { gte: periodStart, lte: periodLastDay } },
    data: { consumedAt: null, consumedForDate: null, consumedForRequestId: null },
  });
}
