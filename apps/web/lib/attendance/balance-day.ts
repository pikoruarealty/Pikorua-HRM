import { RequestStatus, RequestType, WorkLocation } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getMonthlyAttendanceBreakdown } from "@/lib/attendance/monthly-breakdown";
import { allocateCompensationCredits, loadWfhRequestDates } from "@/lib/attendance/compensation-credits";
import { todayDateOnly } from "@/lib/attendance/time";
import { isFixedSchedule } from "@/lib/attendance/weekly-off";
import { isAttendanceExemptRole } from "@/lib/attendance/tracking";

// "Use a balance day" (2026-10-24, owner request). An employee who worked in
// advance holds a balance day (a compensation credit). They may ask to use it on a
// specific absent / unpaid-leave day: that is a Request of type `balance_day`
// (dateFrom = dateTo = the day), approved by Admin/HR like any other request. On
// approval the credit is spent on that day (`applied`), and attendance counts the
// day as covered straight away (monthly-breakdown.ts `balanceDates`) — shown as a
// paid-leave day with the note "balance", separate from ordinary leave.
//
// This file is the single definition of "can this day take a balance day?", used
// when the request is filed AND again when it is approved (things change in
// between: leave gets approved, a payslip gets generated, the credit gets used).

export type BalanceDayCheck =
  | {
      ok: true;
      /** The credit that would be spent. */
      creditId: string;
      location: WorkLocation;
      /** What the day currently is, for the message. */
      kind: "absence" | "unpaid_leave";
    }
  | { ok: false; status: number; message: string };

const fail = (message: string, status = 422): BalanceDayCheck => ({ ok: false, status, message });

export async function checkBalanceDay(
  employeeId: string,
  date: Date,
  /** When re-checking at approval: the request being approved, which is not a duplicate of itself. */
  ignoreRequestId?: string,
): Promise<BalanceDayCheck> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { role: true, employmentType: true, requiredDaysPerWeek: true },
  });
  if (!employee) return fail("Employee not found.", 404);
  if (isAttendanceExemptRole(employee.role)) return fail("Attendance isn't tracked for Admin accounts.");
  if (!isFixedSchedule(employee)) {
    return fail("Balance days apply to fixed-schedule employees; a part-timer's days are paid by days worked.");
  }
  if (date.getTime() >= todayDateOnly().getTime()) {
    return fail("A balance day can only be used on a day that is already over.");
  }

  const month = date.getUTCMonth() + 1;
  const year = date.getUTCFullYear();
  const payslip = await prisma.payslip.findUnique({
    where: { employeeId_periodYear_periodMonth: { employeeId, periodYear: year, periodMonth: month } },
    select: { id: true },
  });
  if (payslip) return fail("That month already has a payslip, so it can't be changed.", 409);

  const key = date.toISOString().slice(0, 10);
  const breakdown = await getMonthlyAttendanceBreakdown(employeeId, month, year);
  const day = breakdown.days.find((d) => d.date === key);
  const wholeUnpaid = day?.status === "unpaid_leave" && day.leaveUnpaid === 1;
  if (!day || (day.status !== "absent" && !wholeUnpaid) || (day.absentPart ?? 0) > 0) {
    const what = !day
      ? "isn't a working day on record"
      : day.status === "paid_leave" && day.note === "balance"
        ? "already has a balance day on it"
        : `is ${day.status.replace(/_/g, " ")}`;
    return fail(`That day ${what} — a balance day can only cover a whole absent or unpaid-leave day.`);
  }

  // One request per day: a second one for a day already asked for would just
  // compete for the same credit.
  const existing = await prisma.request.findFirst({
    where: {
      employeeId,
      type: RequestType.balance_day,
      status: { in: [RequestStatus.pending, RequestStatus.approved] },
      dateFrom: date,
      ...(ignoreRequestId ? { id: { not: ignoreRequestId } } : {}),
    },
    select: { status: true },
  });
  if (existing) {
    return fail(
      existing.status === RequestStatus.pending
        ? "A balance-day request for that day is already waiting for approval."
        : "A balance day has already been approved for that day.",
      409,
    );
  }

  const wfhDates = await loadWfhRequestDates(employeeId, date, date);
  const location = wfhDates.has(key) ? WorkLocation.wfh : WorkLocation.office;

  const credits = await prisma.compensationCredit.findMany({
    where: { employeeId, consumedAt: null, applied: false },
    select: { id: true, earnedDate: true, expiresAt: true, workLocation: true },
  });
  const pick = allocateCompensationCredits([{ date, location }], [], credits)[0];
  if (!pick) {
    return fail(
      location === WorkLocation.office
        ? "No balance day can cover that day: it needs one earned in the office on or before it, within the last 60 days."
        : "No balance day can cover that day: it needs one earned on or before it, within the last 60 days.",
    );
  }

  return { ok: true, creditId: pick.creditId, location, kind: day.status === "absent" ? "absence" : "unpaid_leave" };
}

/**
 * Gives back the credit an APPROVED balance-day request spent, so the day goes back
 * to being absent / unpaid. Used when Admin takes the approval back (override) or
 * deletes the request outright — either would otherwise leave the day covered with
 * no request behind it. Refused once the month has a payslip: its numbers are fixed.
 */
export async function releaseBalanceDayCredit(request: {
  id: string;
  employeeId: string;
  dateFrom: Date | null;
}): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  if (request.dateFrom) {
    const payslip = await prisma.payslip.findUnique({
      where: {
        employeeId_periodYear_periodMonth: {
          employeeId: request.employeeId,
          periodYear: request.dateFrom.getUTCFullYear(),
          periodMonth: request.dateFrom.getUTCMonth() + 1,
        },
      },
      select: { id: true },
    });
    if (payslip) {
      return { ok: false, status: 409, message: "That month already has a payslip, so the balance day can't be taken back." };
    }
  }
  await prisma.compensationCredit.updateMany({
    where: { consumedForRequestId: request.id, applied: true },
    data: {
      consumedAt: null,
      consumedForDate: null,
      consumedForRequestId: null,
      applied: false,
      appliedByUserId: null,
      appliedAt: null,
    },
  });
  return { ok: true };
}
