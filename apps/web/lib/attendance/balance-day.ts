import { Prisma, RequestStatus, RequestType, WorkLocation } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getMonthlyAttendanceWithLedger } from "@/lib/attendance/monthly-breakdown";
import { eligibleBalanceDays, loadWfhRequestDates } from "@/lib/attendance/compensation-credits";
import { todayDateOnly } from "@/lib/attendance/time";
import { isFixedSchedule } from "@/lib/attendance/weekly-off";
import { isAttendanceExemptRole } from "@/lib/attendance/tracking";
import { EXTRA_DAY_RULE_FROM, pickBankedDay } from "@/lib/attendance/extra-days";

// "Use a balance day" (2026-10-24, owner request). An employee who worked in
// advance holds a balance day. They may ask to use it on a specific absent /
// unpaid-leave day: that is a Request of type `balance_day` (dateFrom = dateTo = the
// day), approved by Admin/HR like any other request. On approval the balance day is
// spent on that day (a compensation_credits row with `applied`), and attendance counts
// the day as covered straight away (monthly-breakdown.ts `balanceDates`) — shown as a
// paid-leave day with the note "balance", separate from ordinary leave.
//
// 2026-11-01: balance days are derived from attendance by the walk's ledger
// (lib/attendance/extra-days.ts), so this checks against that ledger and names the
// day worked in advance that would be spent (`sourceDate`); approval writes the row.
// Part-timers bank balance days too now (their extra days aren't paid), so they can
// use one on a day not worked in a week left short of their quota.
//
// This file is the single definition of "can this day take a balance day?", used
// when the request is filed AND again when it is approved (things change in
// between: leave gets approved, a payslip gets generated, the day gets made up).

export type BalanceDayCheck =
  | {
      ok: true;
      /** The day worked in advance whose balance day would be spent. */
      sourceDate: string;
      /** Its last day of use. */
      expires: string;
      /** Where that day was worked. */
      sourceLocation: WorkLocation;
      /** Where the day to cover was owed. */
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
  const today = todayDateOnly();
  if (date.getTime() >= today.getTime()) {
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
  const { breakdown, ledger } = await getMonthlyAttendanceWithLedger(employeeId, month, year);
  const fixed = isFixedSchedule(employee);
  const eligible = eligibleBalanceDays(breakdown, fixed, today.toISOString().slice(0, 10)).find((d) => d.date === key);
  if (!eligible) {
    const day = breakdown.days.find((d) => d.date === key);
    const what = !day
      ? "isn't a working day on record"
      : day.madeUpOn
        ? `was already made up by the extra day worked on ${day.madeUpOn}`
        : day.status === "paid_leave" && day.note === "balance"
          ? "already has a balance day on it"
          : !fixed && day.status === "no_record"
            ? "isn't in a week left short of the weekly quota"
            : `is ${day.status.replace(/_/g, " ")}`;
    return fail(
      `That day ${what} — a balance day can only cover a whole absent or unpaid-leave day${
        fixed ? "" : " (for a part-timer, a day not worked in a week short of the quota)"
      }.`,
    );
  }

  // One request per day: a second one for a day already asked for would just
  // compete for the same balance day.
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
  const pick = pickBankedDay(ledger.bank, key, location);
  if (!pick) {
    return fail(
      location === WorkLocation.office
        ? "No balance day can cover that day: it needs a day worked in advance in the office on or before it, within the last 60 days."
        : "No balance day can cover that day: it needs a day worked in advance on or before it, within the last 60 days.",
    );
  }

  return {
    ok: true,
    sourceDate: pick.date,
    expires: pick.expires,
    sourceLocation: pick.location as WorkLocation,
    location,
    kind: eligible.kind,
  };
}

/**
 * Spends the balance day a check picked on `request`'s day: writes the
 * compensation_credits row for the day worked in advance, marked `applied`. Returns
 * false if that balance day was spent in the meantime (a concurrent approval).
 */
export async function spendBalanceDay(
  check: Extract<BalanceDayCheck, { ok: true }>,
  request: { id: string; employeeId: string; dateFrom: Date },
  approverUserId: string,
  at: Date,
): Promise<{ ok: true; creditId: string } | { ok: false; message: string }> {
  const source = await prisma.attendanceRecord.findUnique({
    where: {
      employeeId_date: { employeeId: request.employeeId, date: new Date(`${check.sourceDate}T00:00:00.000Z`) },
    },
    select: { id: true },
  });
  if (!source) return { ok: false, message: "The day worked in advance behind that balance day is gone — try again." };

  const spent = {
    consumedAt: at,
    consumedForDate: request.dateFrom,
    consumedForRequestId: request.id,
    applied: true,
    appliedByUserId: approverUserId,
    appliedAt: at,
  };
  try {
    const row = await prisma.compensationCredit.create({
      data: {
        employeeId: request.employeeId,
        earnedDate: new Date(`${check.sourceDate}T00:00:00.000Z`),
        expiresAt: new Date(`${check.expires}T00:00:00.000Z`),
        sourceRecordId: source.id,
        workLocation: check.sourceLocation,
        ...spent,
      },
      select: { id: true },
    });
    return { ok: true, creditId: row.id };
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") throw err;
    // A row already exists for that day: fine only if it is still unspent.
    const updated = await prisma.compensationCredit.updateMany({
      where: { sourceRecordId: source.id, consumedAt: null },
      data: spent,
    });
    if (updated.count !== 1) return { ok: false, message: "That balance day was just used for something else — try again." };
    const row = await prisma.compensationCredit.findUnique({ where: { sourceRecordId: source.id }, select: { id: true } });
    return { ok: true, creditId: row!.id };
  }
}

/**
 * Gives back the balance day an APPROVED balance-day request spent, so the day goes
 * back to being absent / unpaid. Used when Admin takes the approval back (override) or
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
  // Under the make-up rule an unused balance day has no row (it is derived), so
  // giving one back is deleting the row its use wrote. Older rows are reset.
  const ruleDate = new Date(`${EXTRA_DAY_RULE_FROM}T00:00:00.000Z`);
  await prisma.compensationCredit.deleteMany({
    where: { consumedForRequestId: request.id, applied: true, earnedDate: { gte: ruleDate } },
  });
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
