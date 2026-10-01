import { AttendanceApprovalStatus, WorkLocation } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  getMonthlyAttendanceBreakdown,
  type ClassifiedDay,
  type DayStatus,
  type MonthlyBreakdown,
} from "@/lib/attendance/monthly-breakdown";

// 2026-09-30 — the month view behind the attendance calendar and the in-office /
// WFH split. Two things it must never do: disagree with the tiles (day statuses
// come straight from classifyMonth's own walk, see MonthlyBreakdown.days), and
// hide a day that has a record but is not approved yet (payroll counts approved
// days only, but an employee looking at their own month should still see the day
// they worked — it shows as "pending" until Admin/HR approve it).

const MS_PER_HOUR = 3_600_000;

export type CalendarLocation = "office" | "wfh" | "mixed";

export type CalendarDayStatus = DayStatus | "pending";

export type CalendarDay = {
  /** YYYY-MM-DD */
  date: string;
  /** null = not evaluated: before the employee joined, or still in the future.
   *  `live` = clocked in right now (today only); `today` = today, nothing yet. */
  status: CalendarDayStatus | null;
  /** A record exists for the day but has not been approved yet. */
  pending: boolean;
  location: CalendarLocation | null;
  /** Worked hours; null when there is no record or the day is still open. */
  hours: number | null;
  /** Hours worked so far today, including the session that is still open. Only
   *  set on a `live` day; it is not in any total until the day closes. */
  liveHours: number | null;
  officeHours: number;
  wfhHours: number;
  clockIn: string | null;
  clockOut: string | null;
  sessionCount: number;
  isHalfDay: boolean;
  isCompensation: boolean;
  /** Why the day is what it is, where not obvious — see ClassifiedDay.note. */
  note: ClassifiedDay["note"] | null;
  /** What the day is worth toward pay, in days — same figure the totals use. */
  credit: number;
  /** Leave covering part or all of the day, in days (half-day leave = 0.5). */
  leavePaid: number;
  leaveUnpaid: number;
  /** The part of the day counted absent when only part of it is (see ClassifiedDay). */
  absentPart: number | null;
};

/** What buildAttendanceCalendar reads from the walk; only date and status are required. */
export type ClassifiedDayInput = Pick<ClassifiedDay, "date" | "status"> &
  Partial<Omit<ClassifiedDay, "date" | "status">>;

export type HoursByLocation = { office: number; wfh: number; total: number };

export type AttendanceCalendar = {
  days: CalendarDay[];
  /** Approved days only — the same basis as every count on the tiles. */
  hours: HoursByLocation;
  /** How the worked days (present + half-day + compensation) split by place. */
  workedDays: { office: number; wfh: number };
  /** Per-status split, for the tiles' "x office · y WFH" sub-lines. */
  byStatus: Record<"present" | "half_day" | "compensation", { office: number; wfh: number }>;
  pending: { days: number; hours: number };
};

export type CalendarSession = { clockIn: Date; clockOut: Date | null; workLocation: WorkLocation };

export type CalendarRecord = {
  date: Date;
  workLocation: WorkLocation;
  approvalStatus: AttendanceApprovalStatus;
  clockInRaw: Date | null;
  clockOutRaw: Date | null;
  clockInApproved: Date | null;
  clockOutApproved: Date | null;
  totalHours: number | null;
  isHalfDay: boolean;
  isCompensation: boolean;
  sessions: CalendarSession[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Splits a day's worked hours between office and WFH.
 *
 * Sessions carry the location (you can be home in the morning and in the office
 * after lunch), so the split follows session time. The day's `totalHours` stays
 * the authority on the amount — Admin/HR can set approved times by hand, which
 * makes it differ from the raw session sum — so the session shares are scaled to
 * it rather than added up independently. A day with no sessions (a manual or
 * back-filled record) is wholly the record's own location.
 */
export function splitHoursByLocation(
  totalHours: number | null,
  sessions: CalendarSession[],
  fallback: WorkLocation,
): { office: number; wfh: number } {
  if (totalHours == null || totalHours <= 0) return { office: 0, wfh: 0 };

  let officeMs = 0;
  let wfhMs = 0;
  for (const s of sessions) {
    if (!s.clockOut) continue;
    const ms = Math.max(0, s.clockOut.getTime() - s.clockIn.getTime());
    if (s.workLocation === WorkLocation.wfh) wfhMs += ms;
    else officeMs += ms;
  }
  const spanMs = officeMs + wfhMs;
  if (spanMs <= 0) {
    return fallback === WorkLocation.wfh
      ? { office: 0, wfh: round2(totalHours) }
      : { office: round2(totalHours), wfh: 0 };
  }
  const office = round2((totalHours * officeMs) / spanMs);
  // Derived, not scaled separately, so the two always add back to totalHours.
  return { office, wfh: round2(totalHours - office) };
}

function locationOf(office: number, wfh: number, fallback: WorkLocation): CalendarLocation {
  if (office > 0 && wfh > 0) return "mixed";
  if (wfh > 0) return "wfh";
  if (office > 0) return "office";
  return fallback === WorkLocation.wfh ? "wfh" : "office";
}

/** The place a day is counted under in the per-location tallies: the one where
 *  more of it was spent (office on a tie). */
function primaryLocation(office: number, wfh: number, fallback: WorkLocation): "office" | "wfh" {
  if (office === 0 && wfh === 0) return fallback === WorkLocation.wfh ? "wfh" : "office";
  return wfh > office ? "wfh" : "office";
}

function key(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Hours worked so far across every session, the open one counted up to `now`. Not
 *  scaled to anything: a live day has no approved total to scale to yet. */
export function liveHoursByLocation(sessions: CalendarSession[], now: Date): { office: number; wfh: number } {
  let officeMs = 0;
  let wfhMs = 0;
  for (const s of sessions) {
    const end = s.clockOut ?? now;
    const ms = Math.max(0, end.getTime() - s.clockIn.getTime());
    if (s.workLocation === WorkLocation.wfh) wfhMs += ms;
    else officeMs += ms;
  }
  return { office: round2(officeMs / MS_PER_HOUR), wfh: round2(wfhMs / MS_PER_HOUR) };
}

/** Is this record's day still being worked — clocked in with nothing closed yet? */
function isOpenRecord(r: CalendarRecord): boolean {
  if (r.sessions.length > 0) return r.sessions.some((s) => !s.clockOut);
  // A session-less (manual) record is open until it has a clock-out.
  return !!(r.clockInApproved ?? r.clockInRaw) && !(r.clockOutApproved ?? r.clockOutRaw);
}

/**
 * Pure: day statuses (from classifyMonth) + the month's records -> the calendar.
 * A day classifyMonth did not evaluate (before joining, or in the future) keeps
 * `status: null`.
 *
 * Today is special (2026-10-01): a day still being worked shows as `live`, never
 * as absent. The walk already does this for an approved (device) day, which the
 * biometric sync approves the moment someone punches in; a manual WFH clock-in is
 * *pending* until approved, so the walk sees no record at all and the calendar
 * promotes it here.
 */
export function buildAttendanceCalendar(args: {
  month: number;
  year: number;
  classified: ClassifiedDayInput[];
  records: CalendarRecord[];
  /** Overrides "now" (tests); defaults to the real time. */
  now?: Date;
}): AttendanceCalendar {
  const { month, year, classified, records } = args;
  const now = args.now ?? new Date();
  // Same notion of "today" as classifyMonth: the server-local calendar date.
  const todayKey = key(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
  const statusByDate = new Map(classified.map((d) => [d.date, d.status]));
  const noteByDate = new Map(classified.map((d) => [d.date, d.note ?? null]));
  const classifiedByDate = new Map(classified.map((d) => [d.date, d]));
  const recordByDate = new Map(records.map((r) => [key(r.date), r]));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const hours: HoursByLocation = { office: 0, wfh: 0, total: 0 };
  const workedDays = { office: 0, wfh: 0 };
  const byStatus = {
    present: { office: 0, wfh: 0 },
    half_day: { office: 0, wfh: 0 },
    compensation: { office: 0, wfh: 0 },
  };
  const pending = { days: 0, hours: 0 };
  const days: CalendarDay[] = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const record = recordByDate.get(date);
    const classifiedStatus = statusByDate.get(date) ?? null;

    const isPendingRecord =
      !!record &&
      record.approvalStatus !== AttendanceApprovalStatus.approved &&
      !!(record.clockInApproved ?? record.clockInRaw);

    const split = record
      ? splitHoursByLocation(record.totalHours, record.sessions, record.workLocation)
      : { office: 0, wfh: 0 };

    // A pending record only takes over a day the approved-only walk called
    // something else (absent / weekly off / not evaluated). It never overrides
    // an approved classification.
    let status: CalendarDayStatus | null = classifiedStatus;
    const liveNow = date === todayKey && !!record && isOpenRecord(record) && !!(record.clockInApproved ?? record.clockInRaw);
    if (liveNow && (status === null || status === "absent" || status === "weekly_off" || status === "no_record" || status === "today")) {
      // Clocked in right now: not absent, whether or not anyone has approved it yet.
      status = "live";
    } else if (
      isPendingRecord &&
      (status === null || status === "absent" || status === "weekly_off" || status === "no_record" || status === "today")
    ) {
      status = "pending";
    }
    const live = status === "live";
    const liveSplit = live && record ? liveHoursByLocation(record.sessions, now) : null;

    const worked = status === "present" || status === "half_day" || status === "compensation";
    if (worked && record && record.approvalStatus === AttendanceApprovalStatus.approved) {
      hours.office += split.office;
      hours.wfh += split.wfh;
      const place = primaryLocation(split.office, split.wfh, record.workLocation);
      workedDays[place] += 1;
      byStatus[status as "present" | "half_day" | "compensation"][place] += 1;
    }
    if (status === "pending") {
      pending.days += 1;
      pending.hours += split.office + split.wfh;
    }

    const walked = classifiedByDate.get(date);
    days.push({
      date,
      status,
      // A day being worked now is not "awaiting approval" in any useful sense —
      // it is simply not finished.
      pending: isPendingRecord && !live,
      location:
        record && (worked || status === "pending")
          ? locationOf(split.office, split.wfh, record.workLocation)
          : live && record && liveSplit
            ? locationOf(liveSplit.office, liveSplit.wfh, record.workLocation)
            : null,
      hours: record && record.totalHours != null && !live ? Number(record.totalHours) : null,
      liveHours: liveSplit ? round2(liveSplit.office + liveSplit.wfh) : null,
      officeHours: liveSplit ? liveSplit.office : split.office,
      wfhHours: liveSplit ? liveSplit.wfh : split.wfh,
      clockIn: record ? (record.clockInApproved ?? record.clockInRaw)?.toISOString() ?? null : null,
      clockOut: live ? null : record ? (record.clockOutApproved ?? record.clockOutRaw)?.toISOString() ?? null : null,
      sessionCount: record?.sessions.length ?? 0,
      isHalfDay: record?.isHalfDay ?? false,
      isCompensation: record?.isCompensation ?? false,
      note: noteByDate.get(date) ?? null,
      credit: walked?.credit ?? 0,
      leavePaid: walked?.leavePaid ?? 0,
      leaveUnpaid: walked?.leaveUnpaid ?? 0,
      absentPart: walked?.absentPart ?? null,
    });
  }

  hours.office = round2(hours.office);
  hours.wfh = round2(hours.wfh);
  hours.total = round2(hours.office + hours.wfh);
  pending.hours = round2(pending.hours);

  return { days, hours, workedDays, byStatus, pending };
}

/** Loads one employee's month and builds the calendar. Also returns the
 *  breakdown it was built from so a caller needs only one breakdown query. */
export async function getEmployeeAttendanceCalendar(
  employeeId: string,
  month: number,
  year: number,
  breakdown?: MonthlyBreakdown,
): Promise<{ calendar: AttendanceCalendar; breakdown: MonthlyBreakdown }> {
  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(year, month, 1));

  const [records, resolved] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: { employeeId, date: { gte: periodStart, lt: periodEnd } },
      select: {
        date: true,
        workLocation: true,
        approvalStatus: true,
        clockInRaw: true,
        clockOutRaw: true,
        clockInApproved: true,
        clockOutApproved: true,
        totalHours: true,
        isHalfDay: true,
        isCompensation: true,
        sessions: {
          select: { clockIn: true, clockOut: true, workLocation: true },
          orderBy: { clockIn: "asc" },
        },
      },
    }),
    breakdown ? Promise.resolve(breakdown) : getMonthlyAttendanceBreakdown(employeeId, month, year),
  ]);

  const calendar = buildAttendanceCalendar({
    month,
    year,
    classified: resolved.days,
    records: records.map((r) => ({ ...r, totalHours: r.totalHours === null ? null : Number(r.totalHours) })),
  });
  return { calendar, breakdown: resolved };
}
