import { describe, expect, test } from "bun:test";
import { classifyMonth, type ClassifiedDay } from "./monthly-breakdown";
import { addLeaveToDay, type LeaveDayEntry } from "@/lib/requests/leave-math";

// 2026-10-24. A balance day used on purpose (an approved `balance_day` request that
// spent a compensation credit) covers ONE absent / unpaid-leave day. The day becomes
// a paid day shown as `paid_leave` with note `balance`, counted in paidLeaveDays (so
// pay moves exactly as it does for any paid leave) and in balanceDays.

// June 2026: Monday 1 June; Sundays 7/14/21/28 (default off); a past month, so the
// whole month is walked.
const MONTH = 6;
const YEAR = 2026;
const day = (d: number) => `2026-06-${String(d).padStart(2, "0")}`;

type Att = { hasClockIn: boolean; isHalfDay: boolean; isCompensation: boolean; totalHours: number | null };
const full = (hours = 8): Att => ({ hasClockIn: true, isHalfDay: false, isCompensation: false, totalHours: hours });
const half = (hours = 3): Att => ({ hasClockIn: true, isHalfDay: true, isCompensation: false, totalHours: hours });

function fixed(over: Partial<Parameters<typeof classifyMonth>[2]> = {}) {
  return {
    attendanceByDate: new Map<string, Att>(),
    holidayDates: new Set<string>(),
    defaultOffDay: 0,
    movedOffDateByWeek: new Map<string, string>(),
    employmentType: "fulltime" as const,
    requiredDaysPerWeek: null,
    dateOfJoining: new Date("2026-06-01T00:00:00.000Z"),
    ...over,
  };
}
const flexible = (over: Partial<Parameters<typeof classifyMonth>[2]> = {}) => ({
  ...fixed(),
  employmentType: "parttime" as never,
  requiredDaysPerWeek: 3,
  ...over,
});
const entryOf = (r: ReturnType<typeof classifyMonth>, d: number): ClassifiedDay => r.days.find((x) => x.date === day(d))!;

/** Everyone works Mon-Sat except the listed days (Sundays are the weekly off). */
function worked(...skip: number[]): Map<string, Att> {
  const m = new Map<string, Att>();
  for (let d = 1; d <= 30; d++) {
    if (new Date(Date.UTC(2026, 5, d)).getUTCDay() === 0) continue;
    if (!skip.includes(d)) m.set(day(d), full());
  }
  return m;
}

describe("a balance day on an absent day", () => {
  // Wednesday 10 June has no record: absent. (Not an automatic off — the Sunday
  // of that week, the 14th, is not worked, so it stays the off.)
  const base = fixed({ attendanceByDate: worked(10) });

  test("without a balance day the day is absent and unpaid", () => {
    const r = classifyMonth(MONTH, YEAR, base);
    expect(entryOf(r, 10)).toMatchObject({ status: "absent", credit: 0 });
    expect(r.absentDays).toBe(1);
    expect(r.balanceDays).toBe(0);
  });

  test("with one it is a paid day, shown separately, and no longer absent", () => {
    const without = classifyMonth(MONTH, YEAR, base);
    const r = classifyMonth(MONTH, YEAR, { ...base, balanceDates: new Set([day(10)]) });
    expect(entryOf(r, 10)).toMatchObject({ status: "paid_leave", note: "balance", credit: 1, leavePaid: 1 });
    expect(r.absentDays).toBe(0);
    expect(r.absentDates).toEqual([]);
    expect(r.paidLeaveDays).toBe(1);
    expect(r.balanceDays).toBe(1);
    // Pay moves by exactly one day, no more.
    expect(r.payableDays).toBe(without.payableDays + 1);
  });

  test("payable days still equal the sum of the days' credits and the pay formula", () => {
    const r = classifyMonth(MONTH, YEAR, { ...base, balanceDates: new Set([day(10)]) });
    const summed = r.days.reduce((a, d) => a + d.credit, 0);
    const formula = r.presentDays + r.halfDays * 0.5 + r.paidLeaveDays + r.holidayDays + r.compensationDays;
    expect(r.payableDays).toBe(summed);
    expect(r.payableDays).toBe(formula);
  });
});

describe("a balance day on an unpaid-leave day", () => {
  const unpaid = new Map<string, LeaveDayEntry>();
  addLeaveToDay(unpaid, day(10), "leave_unpaid", false);
  const base = fixed({ attendanceByDate: worked(10), leaveByDate: unpaid });

  test("the unpaid day becomes a paid balance day, not unpaid and paid at once", () => {
    const before = classifyMonth(MONTH, YEAR, base);
    expect(entryOf(before, 10)).toMatchObject({ status: "unpaid_leave", credit: 0 });
    expect(before.unpaidLeaveDays).toBe(1);

    const r = classifyMonth(MONTH, YEAR, { ...base, balanceDates: new Set([day(10)]) });
    expect(entryOf(r, 10)).toMatchObject({ status: "paid_leave", note: "balance", credit: 1 });
    expect(r.unpaidLeaveDays).toBe(0);
    expect(r.paidLeaveDays).toBe(1);
    expect(r.balanceDays).toBe(1);
    expect(r.payableDays).toBe(before.payableDays + 1);
  });
});

describe("a balance day never covers a day that is not entirely empty", () => {
  test("ignored on a day worked in full", () => {
    const r = classifyMonth(MONTH, YEAR, fixed({ attendanceByDate: worked(), balanceDates: new Set([day(10)]) }));
    expect(entryOf(r, 10)).toMatchObject({ status: "present", credit: 1 });
    expect(r.balanceDays).toBe(0);
    expect(r.paidLeaveDays).toBe(0);
  });

  test("ignored on a half-day worked (it would pay 1.5)", () => {
    const att = worked(10);
    att.set(day(10), half());
    const r = classifyMonth(MONTH, YEAR, fixed({ attendanceByDate: att, balanceDates: new Set([day(10)]) }));
    expect(entryOf(r, 10).credit).toBe(0.5);
    expect(r.balanceDays).toBe(0);
  });

  test("ignored when real paid leave already covers the day", () => {
    const paid = new Map<string, LeaveDayEntry>();
    addLeaveToDay(paid, day(10), "leave_casual", false);
    const r = classifyMonth(
      MONTH,
      YEAR,
      fixed({ attendanceByDate: worked(10), leaveByDate: paid, balanceDates: new Set([day(10)]) }),
    );
    expect(entryOf(r, 10)).toMatchObject({ status: "paid_leave", credit: 1 });
    expect(entryOf(r, 10).note).toBeUndefined();
    expect(r.balanceDays).toBe(0);
    expect(r.paidLeaveDays).toBe(1);
  });

  test("a half-day paid leave plus a balance day does not pay more than one day", () => {
    const halfLeave = new Map<string, LeaveDayEntry>();
    addLeaveToDay(halfLeave, day(10), "leave_casual", true);
    const r = classifyMonth(
      MONTH,
      YEAR,
      fixed({ attendanceByDate: worked(10), leaveByDate: halfLeave, balanceDates: new Set([day(10)]) }),
    );
    expect(entryOf(r, 10).credit).toBe(0.5);
    expect(r.balanceDays).toBe(0);
  });
});

describe("balance days and the rest of the walk", () => {
  test("a part-timer's walk ignores balance days (not eligible; paid by days worked)", () => {
    const att = new Map<string, Att>([[day(8), full()]]);
    const a = classifyMonth(MONTH, YEAR, flexible({ attendanceByDate: att }));
    const b = classifyMonth(MONTH, YEAR, flexible({ attendanceByDate: att, balanceDates: new Set([day(9)]) }));
    expect(b.payableDays).toBe(a.payableDays);
    expect(b.balanceDays).toBe(0);
  });

  test("two balance days on two days count twice, and only those days", () => {
    const base = fixed({ attendanceByDate: worked(9, 10) });
    const r = classifyMonth(MONTH, YEAR, { ...base, balanceDates: new Set([day(9), day(10)]) });
    expect(r.balanceDays).toBe(2);
    expect(r.absentDays).toBe(0);
    expect(r.payableDays).toBe(classifyMonth(MONTH, YEAR, base).payableDays + 2);
  });

  test("a balance day counts as an explained day for the week's weekly-off pick", () => {
    // Sunday 14 June worked + Wednesday 10 June skipped would make the 10th the
    // week's automatic off (nothing owed). With a balance day on the 10th it is
    // explained, so it cannot be taken as the off — it stays a covered day.
    const att = worked(10);
    att.set(day(14), full());
    const without = classifyMonth(MONTH, YEAR, fixed({ attendanceByDate: att }));
    expect(entryOf(without, 10).status).toBe("weekly_off");
    const r = classifyMonth(MONTH, YEAR, fixed({ attendanceByDate: att, balanceDates: new Set([day(10)]) }));
    expect(entryOf(r, 10)).toMatchObject({ status: "paid_leave", note: "balance" });
  });
});

// A compact independent oracle: for a fixed-schedule month with only worked days,
// absences and balance days, pay = worked days + holiday-free covered days.
describe("randomised: a balance day adds exactly one day of pay, once", () => {
  function mulberry32(seed: number) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  test("200 random months", () => {
    let totalCovered = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const rnd = mulberry32(seed);
      const att = new Map<string, Att>();
      const leave = new Map<string, LeaveDayEntry>();
      for (let d = 1; d <= 30; d++) {
        const sunday = new Date(Date.UTC(2026, 5, d)).getUTCDay() === 0;
        if (sunday) continue;
        const r = rnd();
        if (r < 0.7) att.set(day(d), rnd() < 0.15 ? half() : full());
        else if (r < 0.8) addLeaveToDay(leave, day(d), "leave_unpaid", false);
        else if (r < 0.85) addLeaveToDay(leave, day(d), "leave_casual", false);
      }
      const balance = new Set<string>();
      for (let d = 1; d <= 30; d++) if (rnd() < 0.2) balance.add(day(d));

      const without = classifyMonth(MONTH, YEAR, fixed({ attendanceByDate: att, leaveByDate: leave }));
      const withBal = classifyMonth(MONTH, YEAR, fixed({ attendanceByDate: att, leaveByDate: leave, balanceDates: balance }));

      // Days the balance can actually cover: nothing worked, no paid leave, a day the walk
      // would count as absent or unpaid (not a Sunday off, not an auto weekly off).
      const covered = withBal.days.filter((x) => x.note === "balance").map((x) => x.date);
      const tag = `seed ${seed}`;
      totalCovered += covered.length;
      // 1. Every covered day was absent or unpaid before, worth 0 then, 1 now.
      for (const date of covered) {
        const before = without.days.find((x) => x.date === date)!;
        expect({ tag, date, s: before.status === "absent" || before.status === "unpaid_leave" }).toEqual({ tag, date, s: true });
        expect(before.credit).toBe(0);
        expect(withBal.days.find((x) => x.date === date)!.credit).toBe(1);
      }
      // 2. Pay moves by exactly the number of covered days.
      expect({ tag, v: withBal.payableDays }).toEqual({ tag, v: without.payableDays + covered.length });
      expect({ tag, v: withBal.balanceDays }).toEqual({ tag, v: covered.length });
      // 3. Absent + unpaid shrink by exactly that many.
      expect({ tag, v: withBal.absentDays + withBal.unpaidLeaveDays }).toEqual({
        tag,
        v: without.absentDays + without.unpaidLeaveDays - covered.length,
      });
      // 4. Still the one pay formula, and no day over a day.
      const formula =
        withBal.presentDays + withBal.halfDays * 0.5 + withBal.paidLeaveDays + withBal.holidayDays + withBal.compensationDays;
      expect({ tag, v: withBal.payableDays }).toEqual({ tag, v: formula });
      for (const d of withBal.days) expect(d.credit).toBeLessThanOrEqual(1);
    }
    // Not vacuous: plenty of days really were covered across the months.
    expect(totalCovered).toBeGreaterThan(100);
  });
});
