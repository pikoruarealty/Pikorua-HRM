import { prisma } from "@/lib/db/prisma";
import { RequestStatus, RequestType } from "@prisma/client";
import { periodBounds, countDaysClippedToPeriod } from "@/lib/requests/leave-math";

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
