import { prisma } from "@/lib/db/prisma";
import { RequestStatus, RequestType } from "@prisma/client";

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
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function getApprovedUnpaidLeaveDays(
  employeeId: string,
  month: number,
  year: number,
): Promise<number> {
  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(year, month, 1)); // exclusive: first day of next month
  // Last countable calendar day of the period (dateTo is inclusive, so we
  // compare against this rather than the exclusive periodEnd).
  const periodLastDay = new Date(periodEnd.getTime() - MS_PER_DAY);

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

    // Clip [dateFrom, dateTo] to [periodStart, periodLastDay], both inclusive.
    const start = r.dateFrom < periodStart ? periodStart : r.dateFrom;
    const end = r.dateTo > periodLastDay ? periodLastDay : r.dateTo;

    // Inclusive day count across the clipped range.
    const days = Math.floor((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
    if (days > 0) totalDays += days;
  }

  return totalDays;
}
