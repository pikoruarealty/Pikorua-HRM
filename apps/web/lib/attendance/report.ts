import { prisma } from "@/lib/db/prisma";
import { getAttendanceSummary } from "@/lib/attendance/summary";
import { getMonthlyAttendanceWithLedger, type MonthlyBreakdown } from "@/lib/attendance/monthly-breakdown";
import { madeUpEntries, type MadeUpEntry } from "@/lib/attendance/compensation-credits";
import type { BankedDay } from "@/lib/attendance/extra-days";
import {
  getEmployeeAttendanceCalendar,
  type AttendanceCalendar,
  type CalendarDay,
} from "@/lib/attendance/calendar";
import { getExpectedHoursForMonth } from "@/lib/attendance/expected-hours";
import { getEffectivePayrollConfig } from "@/lib/payroll/config";
import { resolveDefaultOffDay } from "@/lib/attendance/week";
import { MAX_PLAUSIBLE_SHIFT_HOURS } from "@/lib/attendance/time";
import { formatTime } from "@/lib/format-date";
import { ATTENDANCE_EXEMPT_ROLES } from "@/lib/attendance/tracking";

// Attendance report data (2026-10-01, owner request: "download attendance of
// selected employees for any month — a PDF, one page per employee, with their
// details"). Admin pays salaries by hand from these numbers, so this builds from
// the very same walk the attendance page uses (summary route's inputs) — never a
// second derivation — and carries the per-day `credit` so the page's payable-days
// total can be checked against its own rows.

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** How a status is drawn — the PDF maps this to the same palette as the app. */
export type ReportTone =
  | "office"
  | "wfh"
  | "mixed"
  | "half"
  | "comp"
  | "absent"
  | "paid_leave"
  | "unpaid_leave"
  | "holiday"
  | "off"
  | "live"
  | "pending"
  | "none";

export type ReportDay = {
  date: string;
  weekday: string;
  statusLabel: string;
  tone: ReportTone;
  clockIn: string | null;
  clockOut: string | null;
  hours: number | null;
  place: "Office" | "WFH" | "Mixed" | null;
  /** What the day is worth toward pay, in days. null on a day that was not evaluated. */
  credit: number | null;
  note: string | null;
};

export type AttendanceReportEmployee = {
  employee: {
    id: string;
    fullName: string;
    email: string;
    phone: string | null;
    role: string;
    departmentName: string | null;
    teamName: string | null;
    employmentType: string;
    requiredDaysPerWeek: number | null;
    dateOfJoining: string | null;
    weeklyOff: string;
    wfhAllowed: boolean;
    expectedWfhHoursPerWeek: number | null;
  };
  summary: {
    present: number;
    /** Of `present`, days worked in advance and banked — not paid. */
    banked: number;
    /** Worked but not paid, in days (banked + part-timer WFH-only + over-quota halves). */
    unpaidWork: number;
    /** A part-timer's WFH-only days (counted as WFH hours, not quota days). */
    wfhOnly: number;
    /** A part-timer's half days beyond the week's quota (not paid). */
    overQuotaHalf: number;
    half: number;
    /** Extra days that made up an earlier missed day (paid). */
    compensation: number;
    /** Of `paidLeave`, days covered by a balance day. */
    balanceUsed: number;
    /** Of `absent` / `unpaidLeave`, days a later extra day made up (paid there). */
    madeUpAbsent: number;
    madeUpUnpaid: number;
    /** A part-timer's days owed this month (null for a fixed schedule). */
    daysOwed: number | null;
    absent: number;
    paidLeave: number;
    unpaidLeave: number;
    holidays: number;
    late: number;
    /** (present − banked) + half×0.5 + paid leave + holidays + compensation. */
    payableDays: number;
    pendingDays: number;
    hours: { office: number; wfh: number; total: number };
    expectedHours: number | null;
    workedDays: { office: number; wfh: number };
    /** Where the present / half / compensation days were worked — the same split the
     *  attendance page shows under its tiles. */
    byStatus: AttendanceCalendar["byStatus"];
    /** Present and half days by place — office + WFH always equals present / half. */
    officeFull: number;
    officeHalf: number;
    wfhFull: number;
    wfhHalf: number;
    /** A part-timer's WFH-only days (worth 0), whole and half. */
    wfhOnlyFull: number;
    wfhOnlyHalf: number;
  };
  days: ReportDay[];
  /** Make-ups touching this month (an extra day this month making up a missed day,
   *  possibly last month's; or a missed day this month made up later). */
  madeUp: MadeUpEntry[];
  /** Balance days usable as of the report (earned, still inside their 60 days). */
  balanceAvailable: { earned: string; expires: string; location: string; usable: boolean }[];
  /** Make-ups / balance days that cross a month — which month pays them. */
  crossMonth: string[];
  /** Things worth a second look before paying from this page. */
  flags: string[];
};

/** A part-timer's days owed this month: the days that count here (payable, less the
 *  make-ups of earlier missed days) plus the days missed. Each owed day lands in
 *  exactly one month — a week split across two months is not owed twice — and a
 *  holiday week owes nothing, so a Diwali month owes three weeks' days. */
export function daysOwedOf(b: Pick<MonthlyBreakdown, "payableDays" | "compensationDays" | "absentDays">): number {
  return Math.round((b.payableDays - b.compensationDays + b.absentDays) * 100) / 100;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "18 Sep" — fixed three-letter months (the locale's own gives "Sept" for one month only). */
function shortDay(key: string): string {
  return `${Number(key.slice(8, 10))} ${MON[Number(key.slice(5, 7)) - 1]}`;
}

const frac = (n: number) => (Number.isInteger(n) ? String(n) : n === 0.5 ? "½" : String(n).replace(/\.5$/, "½"));

/** "½ day", "1 day", "1½ days" — plural only above one. */
function daysLabel(n: number): string {
  return `${frac(n)} day${n > 1 ? "s" : ""}`;
}

/**
 * One calendar day -> the row printed for it. Pure.
 *
 * `joinKey` is the joining date (YYYY-MM-DD): a day not evaluated before it reads
 * "Before joining", after it (the future, in the current month) it is left blank.
 */
export function toReportDay(day: CalendarDay, joinKey: string | null): ReportDay {
  const date = day.date;
  const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;
  const leavePaid = day.leavePaid ?? 0;
  const leaveUnpaid = day.leaveUnpaid ?? 0;
  const partialLeave = leavePaid + leaveUnpaid > 0 && leavePaid + leaveUnpaid < 1;

  const base = {
    date,
    weekday,
    clockIn: day.clockIn ? formatTime(day.clockIn) : null,
    clockOut: day.clockOut ? formatTime(day.clockOut) : null,
    hours: day.hours,
    place: (day.location === "office" ? "Office" : day.location === "wfh" ? "WFH" : day.location === "mixed" ? "Mixed" : null) as
      | "Office"
      | "WFH"
      | "Mixed"
      | null,
  };

  const notes: string[] = [];
  const addLeaveNotes = () => {
    if (leavePaid > 0 && (day.hours != null || partialLeave)) notes.push(`${daysLabel(leavePaid)} paid leave`);
    if (leaveUnpaid > 0 && (day.hours != null || partialLeave)) notes.push(`${daysLabel(leaveUnpaid)} unpaid leave`);
    if (day.absentPart != null && day.absentPart > 0) notes.push(`${daysLabel(day.absentPart)} absent`);
  };

  if (day.status === null) {
    const before = joinKey !== null && date < joinKey;
    return {
      ...base,
      statusLabel: before ? "Before joining" : "—",
      tone: "none",
      credit: null,
      note: null,
      clockIn: null,
      clockOut: null,
      hours: null,
      place: null,
    };
  }

  const longDay = day.hours != null && day.hours > MAX_PLAUSIBLE_SHIFT_HOURS;
  const workedNotes = () => {
    if (day.sessionCount > 1) notes.push(`${day.sessionCount} sessions`);
    if (day.note === "wfh_hours") notes.push("WFH only — counts as WFH hours, not a quota day");
    if (day.note === "over_quota") notes.push("Over the week's quota — not paid");
    if (day.note === "advance") {
      notes.push(
        day.banked
          ? `In advance — banked, not paid${day.bankUsedFor ? `; used on ${shortDay(day.bankUsedFor)}` : day.bankExpires ? `; use by ${shortDay(day.bankExpires)}` : ""}`
          : "Worked weekly off (paid)",
      );
    } else if (day.status === "compensation" && day.madeUpFor) {
      notes.push(
        day.madeUpFor.kind === "shortfall" && day.madeUpFor.weekStart
          ? `Made up a day short, week of ${shortDay(day.madeUpFor.weekStart)}`
          : `Made up ${day.madeUpFor.kind === "unpaid_leave" ? "unpaid day" : "absence"} of ${shortDay(day.madeUpFor.date)}`,
      );
    } else if (day.isCompensation && day.status !== "compensation") notes.push("Marked compensation");
    addLeaveNotes();
    if (longDay) notes.push(`Check: ${day.hours}h is unusually long`);
  };

  switch (day.status) {
    case "present": {
      workedNotes();
      return {
        ...base,
        statusLabel: day.banked ? "Present · adv." : "Present",
        tone: day.location === "wfh" ? "wfh" : day.location === "mixed" ? "mixed" : "office",
        credit: day.credit,
        note: notes.join(" · ") || null,
      };
    }
    case "half_day":
      workedNotes();
      return { ...base, statusLabel: "Half day", tone: "half", credit: day.credit, note: notes.join(" · ") || null };
    case "compensation":
      workedNotes();
      return { ...base, statusLabel: "Compensation", tone: "comp", credit: day.credit, note: notes.join(" · ") || null };
    case "absent":
      return {
        ...base,
        statusLabel: "Absent",
        tone: "absent",
        credit: day.credit,
        note: day.madeUpOn ? `Made up on ${shortDay(day.madeUpOn)} (paid there)` : null,
      };
    case "paid_leave":
      addLeaveNotes();
      if (day.note === "balance") {
        notes.push(day.balanceEarned ? `Balance day earned ${shortDay(day.balanceEarned)}` : "Covered by a balance day");
      }
      return {
        ...base,
        statusLabel: day.note === "balance" ? "Balance day" : partialLeave ? "Paid leave ½" : "Paid leave",
        tone: "paid_leave",
        credit: day.credit,
        note: notes.join(" · ") || null,
      };
    case "unpaid_leave":
      addLeaveNotes();
      if (day.note === "declared_unpaid") notes.push("Switched from weekly off by employee");
      if (day.madeUpOn) notes.push(`Made up on ${shortDay(day.madeUpOn)} (paid there)`);
      return {
        ...base,
        statusLabel: partialLeave ? "Unpaid leave ½" : "Unpaid leave",
        tone: "unpaid_leave",
        credit: day.credit,
        note: notes.join(" · ") || null,
      };
    case "holiday":
      return { ...base, statusLabel: "Holiday", tone: "holiday", credit: day.credit, note: null };
    case "weekly_off":
      return {
        ...base,
        statusLabel: "Weekly off",
        tone: "off",
        credit: day.credit,
        note:
          day.note === "auto_off"
            ? "Automatic weekly off"
            : day.note === "provisional_off"
              ? "Weekly off for now — may change"
              : null,
      };
    case "no_record":
      return { ...base, statusLabel: "Not worked", tone: "none", credit: day.credit, note: null };
    case "live":
      return {
        ...base,
        statusLabel: "Clocked in",
        tone: "live",
        credit: 0,
        hours: day.liveHours,
        note: "Today — counted once clocked out",
      };
    case "today":
      return { ...base, statusLabel: "Today", tone: "none", credit: 0, note: "Not clocked in yet" };
    case "pending":
      return {
        ...base,
        statusLabel: "Pending",
        tone: "pending",
        credit: 0,
        note: "Awaiting approval — not counted",
      };
  }
}

/** Load one employee's month and shape it for the report. */
export async function buildAttendanceReportEmployee(
  employeeId: string,
  month: number,
  year: number,
  lateGraceMinutes: number,
): Promise<AttendanceReportEmployee | null> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      role: true,
      employmentType: true,
      requiredDaysPerWeek: true,
      dateOfJoining: true,
      defaultWeeklyOffDay: true,
      wfhAllowed: true,
      expectedWfhHoursPerWeek: true,
      department: { select: { name: true } },
      team: { select: { name: true, defaultWeeklyOffDay: true } },
    },
  });
  if (!employee) return null;

  const [summary, { breakdown, ledger }, expected] = await Promise.all([
    getAttendanceSummary(employeeId, month, year, lateGraceMinutes),
    getMonthlyAttendanceWithLedger(employeeId, month, year),
    getExpectedHoursForMonth(employeeId, month, year),
  ]);
  const { calendar } = await getEmployeeAttendanceCalendar(employeeId, month, year, breakdown);

  return assembleReportEmployee({
    employee,
    lateCount: summary.lateCount,
    breakdown,
    calendar,
    expectedHours: expected?.month ?? null,
    bank: ledger.bank,
  });
}

/** The employee fields the report prints (what the loader above selects). */
export type ReportEmployeeSource = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: string;
  employmentType: string;
  requiredDaysPerWeek: number | null;
  dateOfJoining: Date | null;
  defaultWeeklyOffDay: number | null;
  wfhAllowed: boolean;
  expectedWfhHoursPerWeek: unknown;
  department: { name: string } | null;
  team: { name: string; defaultWeeklyOffDay: number | null } | null;
};

/**
 * Pure: one employee's already-computed month -> the report page. No database, so
 * the shaping rules (what each total is, which flags to raise) can be tested, and so
 * a month can be replayed from stored records.
 */
export function assembleReportEmployee(input: {
  employee: ReportEmployeeSource;
  lateCount: number;
  breakdown: Pick<
    MonthlyBreakdown,
    | "presentDays"
    | "bankedDays"
    | "unpaidWorkDays"
    | "wfhOnlyDays"
    | "overQuotaHalfDays"
    | "balanceDays"
    | "madeUp"
    | "halfDays"
    | "compensationDays"
    | "absentDays"
    | "paidLeaveDays"
    | "unpaidLeaveDays"
    | "holidayDays"
    | "payableDays"
  >;
  calendar: AttendanceCalendar;
  expectedHours: number | null;
  /** The employee's balance days (the walk's ledger); omitted = none. */
  bank?: BankedDay[];
}): AttendanceReportEmployee {
  const { employee, breakdown, calendar } = input;
  const joinKey = employee.dateOfJoining ? employee.dateOfJoining.toISOString().slice(0, 10) : null;
  const days = calendar.days.map((d) => toReportDay(d, joinKey));

  const flags: string[] = [];
  const long = calendar.days.filter((d) => d.hours != null && d.hours > MAX_PLAUSIBLE_SHIFT_HOURS);
  if (long.length > 0) {
    flags.push(
      `${long.length} day${long.length === 1 ? "" : "s"} over ${MAX_PLAUSIBLE_SHIFT_HOURS}h (${long
        .map((d) => d.date.slice(8))
        .join(", ")}) — likely a missed clock-out; hours total may be inflated.`,
    );
  }
  if (calendar.pending.days > 0) {
    flags.push(`${calendar.pending.days} day${calendar.pending.days === 1 ? "" : "s"} awaiting approval are not counted.`);
  }
  if (calendar.days.some((d) => d.status === "live")) {
    flags.push("Today is still open — it is counted once the employee clocks out.");
  }
  const monthKey = calendar.days[0]?.date.slice(0, 7) ?? "";
  const madeUp = madeUpEntries({
    days: calendar.days.flatMap((d) =>
      d.status === "compensation" && d.madeUpFor ? [{ date: d.date, status: "compensation" as const, credit: d.credit, madeUpFor: d.madeUpFor }] : [],
    ),
    madeUp: breakdown.madeUp,
  });
  // A make-up or balance day across months is easy to miss when paying by hand: say
  // which month it is paid in.
  const kindWord = (m: MadeUpEntry) =>
    m.missedKind === "shortfall" ? "short week" : m.missedKind === "unpaid_leave" ? "unpaid day" : "absence";
  const crossMonth: string[] = [];
  for (const m of madeUp) {
    if (m.on.startsWith(monthKey) && !m.missedDate.startsWith(monthKey)) {
      crossMonth.push(
        `${shortDay(m.on)} made up the ${kindWord(m)} of ${shortDay(m.weekStart ?? m.missedDate)} (an earlier month) — paid in this month.`,
      );
    } else if (!m.on.startsWith(monthKey) && m.missedDate.startsWith(monthKey)) {
      crossMonth.push(`The ${kindWord(m)} of ${shortDay(m.weekStart ?? m.missedDate)} was made up on ${shortDay(m.on)} — paid in that month, not here.`);
    }
  }
  for (const d of calendar.days) {
    if (d.status === "paid_leave" && d.note === "balance" && d.balanceEarned && !d.balanceEarned.startsWith(monthKey)) {
      crossMonth.push(`${shortDay(d.date)} is paid from a balance day earned on ${shortDay(d.balanceEarned)} (an earlier month).`);
    }
  }

  const weeklyOffIndex = resolveDefaultOffDay(employee.defaultWeeklyOffDay, employee.team?.defaultWeeklyOffDay);

  return {
    employee: {
      id: employee.id,
      fullName: employee.fullName,
      email: employee.email,
      phone: employee.phone,
      role: employee.role,
      departmentName: employee.department?.name ?? null,
      teamName: employee.team?.name ?? null,
      employmentType: employee.employmentType,
      requiredDaysPerWeek: employee.requiredDaysPerWeek,
      dateOfJoining: joinKey,
      weeklyOff: WEEKDAY_NAMES[weeklyOffIndex]!,
      wfhAllowed: employee.wfhAllowed,
      expectedWfhHoursPerWeek: employee.expectedWfhHoursPerWeek == null ? null : Number(employee.expectedWfhHoursPerWeek),
    },
    summary: {
      present: breakdown.presentDays,
      banked: breakdown.bankedDays,
      unpaidWork: breakdown.unpaidWorkDays,
      wfhOnly: breakdown.wfhOnlyDays,
      overQuotaHalf: breakdown.overQuotaHalfDays,
      half: breakdown.halfDays,
      compensation: breakdown.compensationDays,
      balanceUsed: breakdown.balanceDays,
      madeUpAbsent: breakdown.madeUp.filter((m) => m.missed.kind !== "unpaid_leave").length,
      madeUpUnpaid: breakdown.madeUp.filter((m) => m.missed.kind === "unpaid_leave").length,
      daysOwed:
        employee.employmentType !== "fulltime" && employee.requiredDaysPerWeek ? daysOwedOf(breakdown) : null,
      absent: breakdown.absentDays,
      paidLeave: breakdown.paidLeaveDays,
      unpaidLeave: breakdown.unpaidLeaveDays,
      holidays: breakdown.holidayDays,
      late: input.lateCount,
      payableDays: breakdown.payableDays,
      pendingDays: calendar.pending.days,
      hours: calendar.hours,
      expectedHours: input.expectedHours,
      workedDays: calendar.workedDays,
      byStatus: calendar.byStatus,
      officeFull: calendar.byStatus.present.office,
      wfhFull: breakdown.presentDays - calendar.byStatus.present.office,
      officeHalf: calendar.byStatus.half_day.office,
      wfhHalf: breakdown.halfDays - calendar.byStatus.half_day.office,
      wfhOnlyFull: calendar.days.filter((d) => d.note === "wfh_hours" && d.status === "present").length,
      wfhOnlyHalf: calendar.days.filter((d) => d.note === "wfh_hours" && d.status === "half_day").length,
    },
    days,
    madeUp,
    balanceAvailable: (input.bank ?? [])
      .filter((b) => b.status === "available")
      .map((b) => ({ earned: b.date, expires: b.expires, location: b.location, usable: b.location === "office" })),
    crossMonth,
    flags,
  };
}

/** All employees whose attendance is tracked (active, not attendance-exempt), by name. */
export async function loadReportEmployeeIds(requested: string[] | null): Promise<string[]> {
  const rows = await prisma.employee.findMany({
    where: {
      status: "active",
      role: { notIn: ATTENDANCE_EXEMPT_ROLES },
      ...(requested ? { id: { in: requested } } : {}),
    },
    select: { id: true },
    orderBy: { fullName: "asc" },
  });
  return rows.map((r) => r.id);
}

/** Builds every selected employee's report (a few at a time — each is several queries). */
export async function buildAttendanceReport(
  employeeIds: string[],
  month: number,
  year: number,
): Promise<AttendanceReportEmployee[]> {
  const config = await getEffectivePayrollConfig(month, year);
  const lateGraceMinutes = config?.lateGraceMinutes ?? 0;
  const out: AttendanceReportEmployee[] = [];
  const CHUNK = 4;
  for (let i = 0; i < employeeIds.length; i += CHUNK) {
    const chunk = await Promise.all(
      employeeIds.slice(i, i + CHUNK).map((id) => buildAttendanceReportEmployee(id, month, year, lateGraceMinutes)),
    );
    for (const r of chunk) if (r) out.push(r);
  }
  return out;
}
