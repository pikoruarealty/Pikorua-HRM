import { describe, expect, test } from "bun:test";
import { classifyMonth } from "./monthly-breakdown";

// Past month (June 2026) so classifyMonth's walk to "today" is the whole month.
const MONTH = 6;
const YEAR = 2026;

type Att = { hasClockIn: boolean; isHalfDay: boolean; isCompensation: boolean; totalHours: number | null };

function lookups(over: Partial<Parameters<typeof classifyMonth>[2]> = {}) {
  return {
    attendanceByDate: new Map<string, Att>(),
    leaveTypeByDate: new Map(),
    holidayDates: new Set<string>(),
    // Sunday off, no moves: 7, 14, 21 and 28 June are the off days.
    defaultOffDay: 0,
    movedOffDateByWeek: new Map<string, string>(),
    employmentType: "fulltime" as const,
    requiredDaysPerWeek: null,
    ...over,
  };
}

const day = (d: number) => `2026-06-${String(d).padStart(2, "0")}`;
const present = (totalHours = 9): Att => ({
  hasClockIn: true,
  isHalfDay: false,
  isCompensation: false,
  totalHours,
});

describe("classifyMonth — attendance before the joining date", () => {
  // The 2026-09-30 production discrepancy: joining date 5 Aug, but approved
  // records from 1 Aug (Sat) and 2 Aug (Sun). The tiles skipped both, so a month
  // with 26 approved records counted only 24 days.
  const joined = new Date("2026-06-04T00:00:00.000Z");

  test("a day worked before the joining date still counts", () => {
    const attendanceByDate = new Map<string, Att>([
      [day(1), present()], // Monday, before joining
      [day(2), present()], // Tuesday, before joining
      [day(4), present()], // joining day
    ]);
    const r = classifyMonth(MONTH, YEAR, lookups({ attendanceByDate, dateOfJoining: joined }));
    expect(r.presentDays).toBe(3);
  });

  test("an off day worked before joining is a compensation day", () => {
    const attendanceByDate = new Map<string, Att>([[day(7), present()]]); // Sunday
    const r = classifyMonth(
      MONTH,
      YEAR,
      lookups({ attendanceByDate, dateOfJoining: new Date("2026-06-10T00:00:00.000Z") }),
    );
    expect(r.compensationDays).toBe(1);
  });

  test("unattended days before joining are still not absences", () => {
    const attendanceByDate = new Map<string, Att>([[day(1), present()]]);
    const r = classifyMonth(MONTH, YEAR, lookups({ attendanceByDate, dateOfJoining: joined }));
    // 1 June worked; 2-3 June (before joining, no record) owe nothing; 4-30 June
    // is 27 days minus 4 Sundays = 23 expected, all absent bar none.
    expect(r.absentDays).toBe(23);
    expect(r.workingDaysElapsed).toBe(24);
  });

  test("every approved day lands in exactly one bucket, so the tiles add up to the records", () => {
    const attendanceByDate = new Map<string, Att>();
    for (const d of [1, 2, 3, 4, 5, 6, 7, 8]) attendanceByDate.set(day(d), present());
    const r = classifyMonth(MONTH, YEAR, lookups({ attendanceByDate, dateOfJoining: joined }));
    expect(r.presentDays + r.halfDays + r.compensationDays).toBe(8);
  });

  test("the 2026-08 production case: 26 approved records, joined on the 5th, Sundays worked", () => {
    // Records on every day but 3, 4, 10, 20, 28 of August 2026 (26 days).
    const worked = new Set<number>();
    for (let d = 1; d <= 31; d++) if (![3, 4, 10, 20, 28].includes(d)) worked.add(d);
    const attendanceByDate = new Map<string, Att>();
    for (const d of worked) attendanceByDate.set(`2026-08-${String(d).padStart(2, "0")}`, present(8));
    const r = classifyMonth(8, 2026, lookups({ attendanceByDate, dateOfJoining: new Date("2026-08-05T00:00:00.000Z") }));
    expect(worked.size).toBe(26);
    // Every approved day lands in exactly one worked bucket.
    expect(r.presentDays + r.halfDays + r.compensationDays).toBe(26);
    // Sundays 2 and 9 August: nothing before them in the week to give the off
    // to (3-4 Aug pre-date joining), so they stay compensation days.
    expect(r.compensationDays).toBe(2);
    // 10, 20 and 28 August are no-shows in weeks where the Sunday was worked:
    // each is that week's automatic weekly off, so none is an absence, and the
    // Sundays 16/23/30 are ordinary working days.
    expect(r.absentDays).toBe(0);
    expect(r.days.filter((d) => d.status === "weekly_off").map((d) => d.date)).toEqual([
      "2026-08-10",
      "2026-08-20",
      "2026-08-28",
    ]);
  });
});

describe("classifyMonth — per-day list", () => {
  const joined = new Date("2026-06-01T00:00:00.000Z");

  test("statuses match the counts they were tallied into", () => {
    const attendanceByDate = new Map<string, Att>([
      [day(1), present()],
      [day(2), { hasClockIn: true, isHalfDay: true, isCompensation: false, totalHours: 3 }],
      [day(7), present()], // Sunday
    ]);
    const holidayDates = new Set([day(3)]);
    const r = classifyMonth(MONTH, YEAR, lookups({ attendanceByDate, holidayDates, dateOfJoining: joined }));
    const count = (s: string) => r.days.filter((d) => d.status === s).length;
    expect(count("present")).toBe(r.presentDays);
    expect(count("half_day")).toBe(r.halfDays);
    expect(count("compensation")).toBe(r.compensationDays);
    expect(count("holiday")).toBe(r.holidayDays);
    expect(count("absent")).toBe(r.absentDays);
    expect(r.days.find((d) => d.date === day(14))?.status).toBe("weekly_off");
  });

  test("covers every day from the joining date to the end of a past month, in order", () => {
    const r = classifyMonth(MONTH, YEAR, lookups({ dateOfJoining: joined }));
    expect(r.days).toHaveLength(30);
    expect(r.days.map((d) => d.date)).toEqual([...r.days.map((d) => d.date)].sort());
  });

  test("a flexible schedule lists days it worked and leaves the rest as no_record", () => {
    const attendanceByDate = new Map<string, Att>([
      [day(1), present()],
      [day(2), present()],
    ]);
    const r = classifyMonth(
      MONTH,
      YEAR,
      lookups({
        attendanceByDate,
        dateOfJoining: joined,
        employmentType: "parttime" as never,
        requiredDaysPerWeek: 3,
      }),
    );
    expect(r.days.find((d) => d.date === day(1))?.status).toBe("present");
    expect(r.days.find((d) => d.date === day(5))?.status).toBe("no_record");
  });
});
