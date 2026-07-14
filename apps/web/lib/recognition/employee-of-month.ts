import { prisma } from "@/lib/db/prisma";
import { RecognitionPeriodType } from "@prisma/client";

// CROSS-TRACK CONTRACT (Implementation Plan §5). Owned/implemented by Track B;
// imported by Track A's payslip generation screen (reference display only —
// does NOT affect the payslip calculation). The SIGNATURE is the Phase 0
// agreement — do not change it without flagging Track A.
//
// Returns whether this employee was Employee of the Month for their department
// in the given period (from recognition_snapshots.is_employee_of_month on the
// monthly snapshot). month is 1-12. Returns false (not an error) if no
// snapshot has been computed for that period yet — the cron job at
// POST /api/v1/cron/recognition-snapshot must have run for the period first.
export async function getEmployeeOfMonthStatus(
  employeeId: string,
  month: number,
  year: number,
): Promise<boolean> {
  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const snapshot = await prisma.recognitionSnapshot.findFirst({
    where: {
      employeeId,
      periodType: RecognitionPeriodType.monthly,
      periodStart,
    },
    select: { isEmployeeOfMonth: true },
  });
  return snapshot?.isEmployeeOfMonth ?? false;
}
