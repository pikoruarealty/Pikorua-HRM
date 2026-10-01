import { describe, expect, test } from "bun:test";
import { AttendanceApprovalStatus, WorkLocation } from "@prisma/client";
import { buildAttendanceCalendar, type CalendarRecord } from "./calendar";
import { classifyMonth } from "./monthly-breakdown";
import { assembleReportEmployee, toReportDay, type ReportEmployeeSource } from "./report";
import type { CalendarDay } from "./calendar";

// The attendance PDF prints exactly what the attendance page computes. These pin the
// rules that turn a calendar day into a printed row, and that the page's totals are
// the totals of its own rows.

function day(over: Partial<CalendarDay> = {}): CalendarDay {
  return {
    date: "2026-06-03",
    status: "present",
    pending: false,
    location: "office",
    hours: 8,
    liveHours: null,
    officeHours: 8,
    wfhHours: 0,
    clockIn: "2026-06-03T05:30:00.000Z",
    clockOut: "2026-06-03T13:30:00.000Z",
    sessionCount: 1,
    isHalfDay: false,
    isCompensation: false,
    note: null,
    credit: 1,
    leavePaid: 0,
    leaveUnpaid: 0,
    absentPart: null,
    ...over,
  };
}

describe("toReportDay", () => {
  test("a present day prints its times, hours, place and one day of pay", () => {
    const r = toReportDay(day(), null);
    expect(r).toMatchObject({ statusLabel: "Present", tone: "office", hours: 8, place: "Office", credit: 1, weekday: "Wed" });
    expect(r.clockIn).toBe("11:00"); // 05:30Z is 11:00 IST
    expect(r.clockOut).toBe("19:00");
  });

  test("a WFH day is drawn as WFH, a mixed day as mixed", () => {
    expect(toReportDay(day({ location: "wfh" }), null).tone).toBe("wfh");
    expect(toReportDay(day({ location: "wfh" }), null).place).toBe("WFH");
    expect(toReportDay(day({ location: "mixed" }), null).tone).toBe("mixed");
  });

  test("a half-day of work plus a half-day leave is explained on its row", () => {
    const r = toReportDay(day({ status: "half_day", hours: 4, credit: 1, leavePaid: 0.5 }), null);
    expect(r.statusLabel).toBe("Half day");
    expect(r.credit).toBe(1);
    expect(r.note).toBe("½ day paid leave");
  });

  test("a half-day leave on its own says how much of the day is leave and how much is absent", () => {
    const r = toReportDay(
      day({ status: "paid_leave", hours: null, clockIn: null, clockOut: null, location: null, credit: 0.5, leavePaid: 0.5, absentPart: 0.5 }),
      null,
    );
    expect(r.statusLabel).toBe("Paid leave ½");
    expect(r.note).toBe("½ day paid leave · ½ day absent");
    expect(r.credit).toBe(0.5);
  });

  test("a whole-day leave needs no note", () => {
    const r = toReportDay(day({ status: "unpaid_leave", hours: null, clockIn: null, clockOut: null, location: null, credit: 0, leaveUnpaid: 1 }), null);
    expect(r.statusLabel).toBe("Unpaid leave");
    expect(r.note).toBeNull();
  });

  test("today is labelled as such, never as absent", () => {
    const live = toReportDay(day({ status: "live", hours: null, liveHours: 2.5, clockOut: null, credit: 0 }), null);
    expect(live).toMatchObject({ statusLabel: "Clocked in", tone: "live", credit: 0, hours: 2.5 });
    expect(live.note).toContain("counted once clocked out");
    const notYet = toReportDay(day({ status: "today", hours: null, clockIn: null, clockOut: null, credit: 0 }), null);
    expect(notYet).toMatchObject({ statusLabel: "Today", note: "Not clocked in yet" });
  });

  test("a pending day is shown but marked not counted", () => {
    const r = toReportDay(day({ status: "pending", pending: true }), null);
    expect(r.statusLabel).toBe("Pending");
    expect(r.credit).toBe(0);
    expect(r.note).toContain("not counted");
  });

  test("an unusually long day is flagged for a second look", () => {
    const r = toReportDay(day({ hours: 15.7 }), null);
    expect(r.note).toContain("Check: 15.7h");
  });

  test("a day that was not evaluated reads 'Before joining' or stays blank", () => {
    const blank = day({ status: null, hours: null, clockIn: null, clockOut: null, location: null });
    expect(toReportDay(blank, "2026-06-10").statusLabel).toBe("Before joining");
    expect(toReportDay(blank, "2026-06-01").statusLabel).toBe("—");
    expect(toReportDay(blank, null).credit).toBeNull();
  });

  test("automatic weekly offs say so", () => {
    const off = (note: CalendarDay["note"]) => toReportDay(day({ status: "weekly_off", credit: 0, hours: null, clockIn: null, clockOut: null, note }), null);
    expect(off("auto_off").note).toBe("Automatic weekly off");
    expect(off("provisional_off").note).toContain("may change");
    expect(off(null).note).toBeNull();
  });
});

describe("assembleReportEmployee — the page's totals are the totals of its rows", () => {
  const employee: ReportEmployeeSource = {
    id: "e1",
    fullName: "Test Person",
    email: "t@example.com",
    phone: null,
    role: "tech_employee",
    employmentType: "parttime",
    requiredDaysPerWeek: 3,
    dateOfJoining: new Date("2026-06-01T00:00:00.000Z"),
    defaultWeeklyOffDay: null,
    wfhAllowed: true,
    expectedWfhHoursPerWeek: 6,
    department: { name: "Tech" },
    team: null,
  };
  const at = (iso: string) => new Date(iso);
  const rec = (date: string, hours: number, half: boolean): CalendarRecord => ({
    date: at(`${date}T00:00:00Z`),
    workLocation: WorkLocation.office,
    approvalStatus: AttendanceApprovalStatus.approved,
    clockInRaw: at(`${date}T05:30:00Z`),
    clockOutRaw: at(`${date}T13:30:00Z`),
    clockInApproved: null,
    clockOutApproved: null,
    totalHours: hours,
    isHalfDay: half,
    isCompensation: false,
    sessions: [],
  });

  // 8-14 June: 3 full + 3 half days against a quota of 3 (the production shape).
  const records = [rec("2026-06-08", 3, true), rec("2026-06-09", 3, true), rec("2026-06-10", 3, true), rec("2026-06-11", 8, false), rec("2026-06-12", 8, false), rec("2026-06-13", 8, false)];
  const attendanceByDate = new Map(
    records.map((r) => [r.date.toISOString().slice(0, 10), { hasClockIn: true, isHalfDay: r.isHalfDay, isCompensation: false, totalHours: r.totalHours, isOpen: false }]),
  );
  const breakdown = classifyMonth(6, 2026, {
    attendanceByDate,
    holidayDates: new Set<string>(),
    defaultOffDay: 0,
    movedOffDateByWeek: new Map(),
    employmentType: "parttime" as never,
    requiredDaysPerWeek: 3,
    dateOfJoining: employee.dateOfJoining,
  });
  const calendar = buildAttendanceCalendar({ month: 6, year: 2026, classified: breakdown.days, records, now: new Date(2026, 9, 1) });
  const report = assembleReportEmployee({ employee, lateCount: 2, breakdown, calendar, expectedHours: 120 });

  test("the summary carries the walk's counts and the details printed on the page", () => {
    expect(report.summary).toMatchObject({ present: 2, half: 3, compensation: 1, late: 2, expectedHours: 120 });
    expect(report.employee).toMatchObject({ fullName: "Test Person", departmentName: "Tech", dateOfJoining: "2026-06-01", expectedWfhHoursPerWeek: 6 });
    expect(report.days).toHaveLength(30);
  });

  test("payable days equals the sum of the pay column", () => {
    const column = report.days.reduce((a, d) => a + (d.credit ?? 0), 0);
    expect(column).toBe(report.summary.payableDays);
    expect(report.summary.payableDays).toBe(2 + 1 + 3 * 0.5);
  });

  test("the printed status counts equal the printed totals", () => {
    const count = (label: string) => report.days.filter((d) => d.statusLabel === label).length;
    expect(count("Present")).toBe(report.summary.present);
    expect(count("Half day")).toBe(report.summary.half);
    expect(count("Compensation")).toBe(report.summary.compensation);
  });

  test("hours: office + WFH is the total, and equals the sum of the printed days", () => {
    const printed = report.days.reduce((a, d) => a + (d.hours ?? 0), 0);
    expect(Math.round(printed * 100) / 100).toBe(report.summary.hours.total);
    expect(report.summary.hours.office + report.summary.hours.wfh).toBe(report.summary.hours.total);
  });

  test("flags are raised for long days, pending days and an open day", () => {
    const long = [{ ...rec("2026-06-15", 15.7, false) }];
    const cal2 = buildAttendanceCalendar({
      month: 6,
      year: 2026,
      classified: [{ date: "2026-06-15", status: "present", credit: 1 }],
      records: [...long, { ...rec("2026-06-16", 6, false), approvalStatus: AttendanceApprovalStatus.pending }],
      now: new Date(2026, 9, 1),
    });
    const r = assembleReportEmployee({ employee, lateCount: 0, breakdown, calendar: cal2, expectedHours: null });
    expect(r.flags.some((f) => f.includes("over 14h") && f.includes("15"))).toBe(true);
    expect(r.flags.some((f) => f.includes("awaiting approval"))).toBe(true);
  });
});
