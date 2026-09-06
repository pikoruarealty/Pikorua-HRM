import { AttendanceApprovalStatus, EmploymentType, Prisma, RequestStatus, RequestType } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

/** Either the default prisma singleton or an interactive-transaction client
 *  (tx) — lets commit/rollback run inside the same transaction as the
 *  payslip write that depends on them. */
type Db = typeof prisma | Prisma.TransactionClient;
import { isOffDay } from "@/lib/attendance/week";
import { getOffDayContext } from "@/lib/attendance/monthly-breakdown";
import { periodBounds } from "@/lib/requests/leave-math";

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
// 4. Redemption only converts leave_unpaid days to paid — it feeds
//    lib/payroll/payslip-preview.ts (adjusts paidLeaveDays/unpaidLeaveDays
//    before computeEarnedBasePay), separate from and in addition to the
//    pre-existing "compensated" leave-balance add-back in lib/leave/balance.ts
//    (which has no ledger/expiry and is not touched by this module).

export const COMPENSATION_CREDIT_WINDOW_DAYS = 60;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Re-derives whether an attendance record currently qualifies for a
 *  compensation credit and creates/removes the credit row to match. Called
 *  after any write that could change qualification: approve, the manual
 *  is_compensation edit, and the pre-approved manual/manual-bulk entry
 *  routes. Idempotent — safe to call whether or not anything changed. */
export async function syncCompensationCreditForRecord(recordId: string): Promise<void> {
  const record = await prisma.attendanceRecord.findUnique({
    where: { id: recordId },
    select: {
      id: true,
      employeeId: true,
      date: true,
      approvalStatus: true,
      isCompensation: true,
      clockInApproved: true,
      clockInRaw: true,
    },
  });
  if (!record) return;

  const hasClockIn = !!(record.clockInApproved ?? record.clockInRaw);
  const isApproved = record.approvalStatus === AttendanceApprovalStatus.approved;

  let qualifies = false;
  if (isApproved && hasClockIn) {
    if (record.isCompensation) {
      qualifies = true;
    } else {
      const offDayContext = await getOffDayContext(record.employeeId, record.date, record.date);
      const isFlexible =
        offDayContext.employmentType != null &&
        offDayContext.employmentType !== EmploymentType.fulltime &&
        offDayContext.requiredDaysPerWeek != null &&
        offDayContext.requiredDaysPerWeek > 0 &&
        offDayContext.requiredDaysPerWeek < 7;
      if (!isFlexible) {
        qualifies = isOffDay(record.date, offDayContext.defaultOffDay, offDayContext.movedOffDateByWeek);
      }
    }
  }

  const existingCredit = await prisma.compensationCredit.findUnique({
    where: { sourceRecordId: recordId },
    select: { id: true, consumedAt: true },
  });

  if (qualifies) {
    if (!existingCredit) {
      await prisma.compensationCredit.create({
        data: {
          employeeId: record.employeeId,
          earnedDate: record.date,
          expiresAt: new Date(record.date.getTime() + COMPENSATION_CREDIT_WINDOW_DAYS * MS_PER_DAY),
          sourceRecordId: recordId,
        },
      });
    }
    return;
  }

  // No longer qualifies (e.g. the manual flag was unset). A credit already
  // consumed by a generated payslip is left alone — unwinding it would need
  // to also touch the payslip that consumed it, which this sync has no
  // knowledge of.
  if (existingCredit && !existingCredit.consumedAt) {
    await prisma.compensationCredit.delete({ where: { id: existingCredit.id } });
  }
}

export type CompensationRedemption = { creditId: string; date: Date; requestId: string };

async function getUnpaidLeaveDaysInPeriod(
  employeeId: string,
  month: number,
  year: number,
): Promise<{ date: Date; requestId: string }[]> {
  const { start: periodStart, lastDay: periodLastDay } = periodBounds(month, year);
  const requests = await prisma.request.findMany({
    where: {
      employeeId,
      type: RequestType.leave_unpaid,
      status: RequestStatus.approved,
      dateFrom: { lte: periodLastDay },
      dateTo: { gte: periodStart },
    },
    select: { id: true, dateFrom: true, dateTo: true },
  });

  const days: { date: Date; requestId: string }[] = [];
  for (const r of requests) {
    if (!r.dateFrom || !r.dateTo) continue;
    const start = r.dateFrom < periodStart ? periodStart : r.dateFrom;
    const end = r.dateTo > periodLastDay ? periodLastDay : r.dateTo;
    for (let t = start.getTime(); t <= end.getTime(); t += MS_PER_DAY) {
      days.push({ date: new Date(t), requestId: r.id });
    }
  }
  return days;
}

/** Pure allocator (unit-testable without a DB): greedily matches each
 *  unpaid-leave day, oldest first, against the unconsumed credit that covers
 *  it and expires soonest — so no credit is left idle while an earlier one
 *  expires unused. Each credit and each leave day is used at most once. */
export function allocateCompensationCredits(
  unpaidLeaveDays: { date: Date; requestId: string }[],
  credits: { id: string; earnedDate: Date; expiresAt: Date }[],
): CompensationRedemption[] {
  if (unpaidLeaveDays.length === 0 || credits.length === 0) return [];

  const sortedDays = [...unpaidLeaveDays].sort((a, b) => a.date.getTime() - b.date.getTime());
  const sortedCredits = [...credits].sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  const usedCreditIds = new Set<string>();
  const redemptions: CompensationRedemption[] = [];

  for (const day of sortedDays) {
    const match = sortedCredits.find(
      (c) =>
        !usedCreditIds.has(c.id) &&
        c.earnedDate.getTime() <= day.date.getTime() &&
        day.date.getTime() <= c.expiresAt.getTime(),
    );
    if (match) {
      usedCreditIds.add(match.id);
      redemptions.push({ creditId: match.id, date: day.date, requestId: day.requestId });
    }
  }
  return redemptions;
}

/** Dry-run: which approved leave_unpaid days in this month WOULD be redeemed
 *  against this employee's unconsumed compensation credits. Read-only — does
 *  not touch consumedAt. Used by payslip-preview.ts (both the live preview
 *  and as the exact list generate/recompute commit transactionally, so what
 *  the user previewed is exactly what gets persisted). */
export async function computeCompensationRedemption(
  employeeId: string,
  month: number,
  year: number,
): Promise<CompensationRedemption[]> {
  const [unpaidDays, credits] = await Promise.all([
    getUnpaidLeaveDaysInPeriod(employeeId, month, year),
    prisma.compensationCredit.findMany({
      where: { employeeId, consumedAt: null },
      select: { id: true, earnedDate: true, expiresAt: true },
    }),
  ]);

  return allocateCompensationCredits(unpaidDays, credits);
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

/** Un-commits every credit this employee's payslip for the given period
 *  consumed — called when a draft payslip is deleted, so the credits go back
 *  into the pool instead of being silently burned with no way to redeem them
 *  again on a subsequent regenerate. Identifies them by consumedForDate
 *  falling inside the period, since redemption only ever allocates dates
 *  strictly within the month being processed. */
export type CompensationCreditSummary = { activeCount: number; nearestExpiry: Date | null };

/** Active (unconsumed, unexpired) compensation-credit count + nearest expiry
 *  for one employee — surfaced in the leave balance panel (GET
 *  /leave-config/balance) so an employee can see they've earned a credit
 *  and by when they need to use it. */
export async function getCompensationCreditSummary(employeeId: string): Promise<CompensationCreditSummary> {
  const credits = await prisma.compensationCredit.findMany({
    where: { employeeId, consumedAt: null, expiresAt: { gte: new Date() } },
    select: { expiresAt: true },
    orderBy: { expiresAt: "asc" },
  });
  return { activeCount: credits.length, nearestExpiry: credits[0]?.expiresAt ?? null };
}

export async function rollbackCompensationRedemptionsForPeriod(
  employeeId: string,
  month: number,
  year: number,
  db: Db = prisma,
): Promise<void> {
  const { start: periodStart, lastDay: periodLastDay } = periodBounds(month, year);
  await db.compensationCredit.updateMany({
    where: { employeeId, consumedForDate: { gte: periodStart, lte: periodLastDay } },
    data: { consumedAt: null, consumedForDate: null, consumedForRequestId: null },
  });
}
