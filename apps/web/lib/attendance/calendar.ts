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
  /** null = not evaluated: before the employee joined, or still in the future. */
  status: CalendarDayStatus | null;
  /** A record exists for the day but has not been approved yet. */
  pending: boolean;
  location: CalendarLocation | null;
  /** Worked hours; null when there is no record or the day is still open. */
  hours: number | null;
  officeHours: number;
  wfhHours: number;
  clockIn: string | null;
  clockOut: string | null;
  sessionCount: number;
  isHalfDay: boolean;
  isCompensation: boolean;
  /** Why the day is what it is, where not obvious — see ClassifiedDay.note. */
  note: ClassifiedDay["note"] | null;
};

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

/**
 * Pure: day statuses (from classifyMonth) + the month's records -> the calendar.
 * A day classifyMonth did not evaluate (before joining, or in the future) keeps
 * `status: null`.
 */
export function buildAttendanceCalendar(args: {
  month: number;
  year: number;
  classified: ClassifiedDay[];
  records: CalendarRecord[];
}): AttendanceCalendar {
  const { month, year, classified, records } = args;
  const statusByDate = new Map(classified.map((d) => [d.date, d.status]));
  const noteByDate = new Map(classified.map((d) => [d.date, d.note ?? null]));
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
    if (isPendingRecord && (status === null || status === "absent" || status === "weekly_off" || status === "no_record")) {
      status = "pending";
    }

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

    days.push({
      date,
      status,
      pending: isPendingRecord,
      location: record && (worked || status === "pending") ? locationOf(split.office, split.wfh, record.workLocation) : null,
      hours: record && record.totalHours != null ? Number(record.totalHours) : null,
      officeHours: split.office,
      wfhHours: split.wfh,
      clockIn: record ? (record.clockInApproved ?? record.clockInRaw)?.toISOString() ?? null : null,
      clockOut: record ? (record.clockOutApproved ?? record.clockOutRaw)?.toISOString() ?? null : null,
      sessionCount: record?.sessions.length ?? 0,
      isHalfDay: record?.isHalfDay ?? false,
      isCompensation: record?.isCompensation ?? false,
      note: noteByDate.get(date) ?? null,
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
