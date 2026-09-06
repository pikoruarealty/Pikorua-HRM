import { prisma } from "@/lib/db/prisma";
import { RequestStatus, RequestType } from "@prisma/client";
import {
  periodBounds,
  countDaysClippedToPeriod,
  yearBounds,
  countDaysClippedToYear,
  PAID_LEAVE_TYPES,
} from "@/lib/requests/leave-math";

// Leave-type overhaul (2026-09-06): leave_paid retired in favor of
// leave_casual + leave_sick sharing one combined pool — every "paid leave"
// query below now matches BOTH types instead of the old single leave_paid.
const PAID_LEAVE_REQUEST_TYPES = PAID_LEAVE_TYPES.map((t) => RequestType[t]);

// CROSS-TRACK CONTRACT — added 2026-07-13 (not in the original Phase 0
// agreement, which only covered getApprovedReimbursementTotal and
// getEmployeeOfMonthStatus; see docs/IMPLEMENTATION_PLAN.md §5 and
// docs/TRACK_A_TASKS.md Milestone 2 notes). Owned/implemented by Track B;
// imported by Track A's attendance summary (lib/attendance/summary.ts) +
// payslip generation. The SIGNATURE below is the agreement — do not change it
// without flagging Track A.
//
// Returns the count of APPROVED unpaid-leave days (requests.type =
// 'leave_unpaid', status = 'approved') for the given employee that fall
// within the given payroll/attendance period (month is 1-12).
//
// IMPLEMENTED 2026-07-14 (was a NotImplementedError stub). Flag to Umang:
// Track A's attendance-summary + payslip generation previously caught the
// NotImplementedError and degraded unpaid leave to 0/"unavailable"; they now
// receive real day counts, so payslip deductions change accordingly.
//
// Period-spanning decision (assumption, not stakeholder-confirmed — logged in
// progress.md / TRACK_B_TASKLIST.md): a leave range that crosses a month
// boundary is CLIPPED to the period — each month counts only the unpaid-leave
// days that actually fall within it. This is the only option that keeps
// per-month payroll deductions correct (no double-counting, no month gets
// days it didn't contain). Both dateFrom and dateTo are inclusive and stored
// as @db.Date (UTC midnight).
export async function getApprovedUnpaidLeaveDays(
  employeeId: string,
  month: number,
  year: number,
): Promise<number> {
  // Clipping math lives in leave-math.ts (pure, unit-tested); this function
  // keeps only the query. Behavior and signature unchanged.
  const { start: periodStart, lastDay: periodLastDay } = periodBounds(month, year);

  // Fetch approved unpaid-leave requests whose range overlaps the period.
  // Overlap condition: dateFrom <= periodLastDay AND dateTo >= periodStart.
  const requests = await prisma.request.findMany({
    where: {
      employeeId,
      type: RequestType.leave_unpaid,
      status: RequestStatus.approved,
      dateFrom: { lte: periodLastDay },
      dateTo: { gte: periodStart },
    },
    select: { dateFrom: true, dateTo: true },
  });

  let totalDays = 0;
  for (const r of requests) {
    // Leave requests always carry both dates (enforced at POST /requests);
    // skip defensively if somehow missing rather than throwing.
    if (!r.dateFrom || !r.dateTo) continue;
    totalDays += countDaysClippedToPeriod(r.dateFrom, r.dateTo, month, year);
  }

  return totalDays;
}

// Added 2026-08-07 (leave-balance feature, owner request). Count of APPROVED
// paid-leave days (leave_casual + leave_sick, shared pool since the
// 2026-09-06 leave-type overhaul) for the employee, clipped to the given
// month. Used against the admin-configured monthly allowance
// (lib/leave/config.ts) to show used/remaining, not by payroll (payroll's
// earned-day math already counts paid-leave days directly via
// lib/attendance/monthly-breakdown.ts).
export async function getApprovedPaidLeaveDays(
  employeeId: string,
  month: number,
  year: number,
): Promise<number> {
  const { start: periodStart, lastDay: periodLastDay } = periodBounds(month, year);

  const requests = await prisma.request.findMany({
    where: {
      employeeId,
      type: { in: PAID_LEAVE_REQUEST_TYPES },
      status: RequestStatus.approved,
      dateFrom: { lte: periodLastDay },
      dateTo: { gte: periodStart },
    },
    select: { dateFrom: true, dateTo: true },
  });

  let totalDays = 0;
  for (const r of requests) {
    if (!r.dateFrom || !r.dateTo) continue;
    totalDays += countDaysClippedToPeriod(r.dateFrom, r.dateTo, month, year);
  }
  return totalDays;
}

/** Same as getApprovedPaidLeaveDays but clipped to a whole calendar year —
 *  used against the yearly allowance. */
export async function getApprovedPaidLeaveDaysForYear(employeeId: string, year: number): Promise<number> {
  const { start: yearStart, lastDay: yearLastDay } = yearBounds(year);

  const requests = await prisma.request.findMany({
    where: {
      employeeId,
      type: { in: PAID_LEAVE_REQUEST_TYPES },
      status: RequestStatus.approved,
      dateFrom: { lte: yearLastDay },
      dateTo: { gte: yearStart },
    },
    select: { dateFrom: true, dateTo: true },
  });

  let totalDays = 0;
  for (const r of requests) {
    if (!r.dateFrom || !r.dateTo) continue;
    totalDays += countDaysClippedToYear(r.dateFrom, r.dateTo, year);
  }
  return totalDays;
}

/** Behind the monthly-cap auto-overflow at approval time (2026-09-06):
 *  already-approved paid-leave-day counts for every calendar month touched
 *  by [dateFrom, dateTo], keyed "YYYY-MM" — lets a request spanning a month
 *  boundary reset its monthly cap correctly per month instead of treating
 *  the whole range as one bucket. */
export async function getApprovedPaidLeaveDaysByMonthsInRange(
  employeeId: string,
  dateFrom: Date,
  dateTo: Date,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const cursor = new Date(Date.UTC(dateFrom.getUTCFullYear(), dateFrom.getUTCMonth(), 1));
  const end = new Date(Date.UTC(dateTo.getUTCFullYear(), dateTo.getUTCMonth(), 1));
  while (cursor <= end) {
    const month = cursor.getUTCMonth() + 1;
    const year = cursor.getUTCFullYear();
    const count = await getApprovedPaidLeaveDays(employeeId, month, year);
    result.set(`${year}-${String(month).padStart(2, "0")}`, count);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return result;
}
