import { EmploymentType } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { expectedWorkingDaysInMonth, getOffDayContext } from "@/lib/attendance/monthly-breakdown";
import { isFixedSchedule } from "@/lib/attendance/weekly-off";

// Expected hours of work, shown (muted) beside the hours actually worked
// (2026-09-30, owner request). The owner's example: part-time, 3 days in office
// on an 8h shift plus 6h WFH a week = 30h a week = 120h a month — so a month is
// four weeks for a part-timer. A full-timer's month is simply their expected
// working days (holidays and weekly offs already out) times the shift.

const DEFAULT_SHIFT_HOURS = 8;
/** A part-timer's month, per the owner's example. */
export const WEEKS_PER_MONTH_FOR_FLEXIBLE = 4;

/** Shift length in hours from a team's "HH:MM" start/end; 8 when unset or
 *  nonsensical (end not after start) — the company default is 11:00-19:00. */
export function shiftHoursFor(start?: string | null, end?: string | null): number {
  const parse = (t?: string | null) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t ?? "");
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const s = parse(start);
  const e = parse(end);
  if (s === null || e === null || e <= s) return DEFAULT_SHIFT_HOURS;
  return Math.round(((e - s) / 60) * 100) / 100;
}

export type ExpectedHours = {
  /** Expected hours for the whole month. */
  month: number;
  /** Per week — part-time / intern only, null for a fixed schedule. */
  weekly: number | null;
  /** The WFH part of `weekly`, when a target is set. */
  wfhWeekly: number | null;
};

export function computeExpectedHours(i: {
  employmentType: EmploymentType;
  requiredDaysPerWeek: number | null;
  expectedWfhHoursPerWeek: number | null;
  shiftHours: number;
  /** Expected working days in the month — used for fixed schedules only. */
  workingDaysInMonth: number;
}): ExpectedHours {
  if (!isFixedSchedule(i)) {
    const wfh = i.expectedWfhHoursPerWeek != null && i.expectedWfhHoursPerWeek > 0 ? i.expectedWfhHoursPerWeek : 0;
    const weekly = (i.requiredDaysPerWeek ?? 0) * i.shiftHours + wfh;
    return {
      month: Math.round(weekly * WEEKS_PER_MONTH_FOR_FLEXIBLE * 100) / 100,
      weekly,
      wfhWeekly: wfh > 0 ? wfh : null,
    };
  }
  return { month: Math.round(i.workingDaysInMonth * i.shiftHours * 100) / 100, weekly: null, wfhWeekly: null };
}

export async function getExpectedHoursForMonth(
  employeeId: string,
  month: number,
  year: number,
): Promise<ExpectedHours | null> {
  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(year, month, 1));
  const [employee, holidays, offCtx] = await Promise.all([
    prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        employmentType: true,
        requiredDaysPerWeek: true,
        expectedWfhHoursPerWeek: true,
        team: { select: { expectedStartTime: true, expectedEndTime: true } },
      },
    }),
    prisma.holiday.findMany({ where: { date: { gte: periodStart, lt: periodEnd } }, select: { date: true } }),
    getOffDayContext(employeeId, periodStart, periodEnd),
  ]);
  if (!employee) return null;

  return computeExpectedHours({
    employmentType: employee.employmentType,
    requiredDaysPerWeek: employee.requiredDaysPerWeek,
    expectedWfhHoursPerWeek:
      employee.expectedWfhHoursPerWeek == null ? null : Number(employee.expectedWfhHoursPerWeek),
    shiftHours: shiftHoursFor(employee.team?.expectedStartTime, employee.team?.expectedEndTime),
    workingDaysInMonth: expectedWorkingDaysInMonth(month, year, {
      holidayDates: new Set(holidays.map((h) => h.date.toISOString().slice(0, 10))),
      defaultOffDay: offCtx.defaultOffDay,
      movedOffDateByWeek: offCtx.movedOffDateByWeek,
    }),
  });
}
