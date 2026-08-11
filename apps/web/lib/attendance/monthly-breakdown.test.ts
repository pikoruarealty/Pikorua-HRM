import { describe, expect, test } from "bun:test";
import { classifyMonth } from "./monthly-breakdown";

// classifyMonth stops at "today", so these all use a month safely in the past
// (June 2026) to keep the walk deterministic.
const MONTH = 6;
const YEAR = 2026;

type Att = { hasClockIn: boolean; isHalfDay: boolean; isCompensation: boolean; totalHours: number | null };

function lookups(over: Partial<Parameters<typeof classifyMonth>[2]> = {}) {
  return {
    attendanceByDate: new Map<string, Att>(),
    leaveTypeByDate: new Map(),
    holidayDates: new Set<string>(),
    // Sunday off, no moves — so June 2026 has 26 working days.
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

describe("classifyMonth — joining date", () => {
  test("without a joining date the whole month is expected (baseline)", () => {
    const r = classifyMonth(MONTH, YEAR, lookups());
    expect(r.workingDaysElapsed).toBe(26);
    expect(r.absentDays).toBe(26);
  });

  test("days before an employee joined are not absences", () => {
    // Joined 22 June: only the 22nd onward is theirs to answer for.
    const r = classifyMonth(MONTH, YEAR, lookups({ dateOfJoining: new Date("2026-06-22T00:00:00.000Z") }));
    expect(r.workingDaysElapsed).toBe(8); // 22-30 June minus Sunday the 28th
    expect(r.absentDays).toBe(8);
  });

  test("a joining date in an earlier month does not clamp anything", () => {
    const r = classifyMonth(MONTH, YEAR, lookups({ dateOfJoining: new Date("2025-01-15T00:00:00.000Z") }));
    expect(r.workingDaysElapsed).toBe(26);
  });

  test("someone who joins after the month has no days at all", () => {
    const r = classifyMonth(MONTH, YEAR, lookups({ dateOfJoining: new Date("2026-09-01T00:00:00.000Z") }));
    expect(r.workingDaysElapsed).toBe(0);
    expect(r.absentDays).toBe(0);
  });

  test("attendance after joining still counts normally", () => {
    const attendanceByDate = new Map<string, Att>([
      [day(22), present()],
      [day(23), present()],
    ]);
    const r = classifyMonth(
      MONTH,
      YEAR,
      lookups({ attendanceByDate, dateOfJoining: new Date("2026-06-22T00:00:00.000Z") }),
    );
    expect(r.presentDays).toBe(2);
    expect(r.absentDays).toBe(6);
  });
});

describe("classifyMonth — what a recorded day is worth", () => {
  const joined = new Date("2026-06-01T00:00:00.000Z");

  test("a full day is present, a short day is half", () => {
    const attendanceByDate = new Map<string, Att>([
      [day(1), present(9)],
      [day(2), { hasClockIn: true, isHalfDay: true, isCompensation: false, totalHours: 3 }],
    ]);
    const r = classifyMonth(MONTH, YEAR, lookups({ attendanceByDate, dateOfJoining: joined }));
    expect(r.presentDays).toBe(1);
    expect(r.halfDays).toBe(1);
  });

  test("a zero-hour record is an absence, not a paid full day", () => {
    // Clock in and straight back out used to arrive here as isHalfDay=false and
    // be counted — and paid — as a whole day.
    const attendanceByDate = new Map<string, Att>([
      [day(1), { hasClockIn: true, isHalfDay: false, isCompensation: false, totalHours: 0 }],
    ]);
    const r = classifyMonth(MONTH, YEAR, lookups({ attendanceByDate, dateOfJoining: joined }));
    expect(r.presentDays).toBe(0);
    expect(r.halfDays).toBe(0);
    expect(r.absentDays).toBe(26);
  });

  test("a day still in progress (no clock-out) counts as present", () => {
    const attendanceByDate = new Map<string, Att>([
      [day(1), { hasClockIn: true, isHalfDay: false, isCompensation: false, totalHours: null }],
    ]);
    const r = classifyMonth(MONTH, YEAR, lookups({ attendanceByDate, dateOfJoining: joined }));
    expect(r.presentDays).toBe(1);
  });
});
