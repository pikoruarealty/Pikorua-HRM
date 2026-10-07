import { describe, expect, test } from "bun:test";
import { classifyMonth, type ClassifiedDay } from "./monthly-breakdown";
import { dayCredit } from "./time";
import { addLeaveToDay, type LeaveDayEntry } from "@/lib/requests/leave-math";

// 2026-10-01. The counting rules behind the attendance tiles, the calendar and the
// pay figure. The invariant that matters most — and that the old walk broke — is
// that a day is counted ONCE: tiles, calendar and pay all come from the same days,
// and the pay credit equals what the raw records and leave say it should be.

// A past month so the walk covers all of it. June 2026: Monday 1 June, Sundays 7/14/21/28.
const MONTH = 6;
const YEAR = 2026;

type Att = {
  hasClockIn: boolean;
  isHalfDay: boolean;
  isCompensation: boolean;
  totalHours: number | null;
  isOpen?: boolean;
};

const day = (d: number) => `2026-06-${String(d).padStart(2, "0")}`;
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
function flexible(over: Partial<Parameters<typeof classifyMonth>[2]> = {}) {
  return { ...fixed(), employmentType: "parttime" as never, requiredDaysPerWeek: 3, ...over };
}
const leave = (entries: Record<string, LeaveDayEntry>) => new Map(Object.entries(entries));
const entryOf = (r: ReturnType<typeof classifyMonth>, d: number): ClassifiedDay => r.days.find((x) => x.date === day(d))!;

describe("a part-timer's week over quota — whole days, matching the calendar", () => {
  // The 2026-09-30 production case, scaled to June: quota 3/week; week of 8-14 June
  // is 3 full days + 3 half days = 4.5 credit. The old walk moved 1.5 days from
  // present to compensation (tiles), but the calendar can only relabel whole days.
  const week = new Map<string, Att>([
    [day(8), half()],
    [day(9), half()],
    [day(10), half()],
    [day(11), full()],
    [day(12), full()],
    [day(13), full()],
  ]);

  test("tiles are whole numbers and equal the calendar's own day count", () => {
    const r = classifyMonth(MONTH, YEAR, flexible({ attendanceByDate: week }));
    const count = (s: string) => r.days.filter((d) => d.status === s).length;
    expect(Number.isInteger(r.presentDays)).toBe(true);
    expect(Number.isInteger(r.compensationDays)).toBe(true);
    expect(r.presentDays).toBe(count("present"));
    expect(r.compensationDays).toBe(count("compensation"));
    expect(r.halfDays).toBe(count("half_day"));
    // 3 full days: one beyond the 3-credit quota's whole-day overflow (floor(1.5)=1).
    expect(r.compensationDays).toBe(1);
    expect(r.presentDays).toBe(2);
    expect(r.halfDays).toBe(3);
  });

  test("present + compensation is exactly the full days worked, so nothing is added or lost", () => {
    const r = classifyMonth(MONTH, YEAR, flexible({ attendanceByDate: week }));
    expect(r.presentDays + r.compensationDays).toBe(3);
    expect(r.payableDays).toBe(3 + 3 * 0.5); // 4.5 credit, exactly what was worked
  });

  test("a Sunday-worked, 3-days-a-week employee: all worked days are paid once", () => {
    const attendanceByDate = new Map<string, Att>();
    for (const d of [1, 2, 3, 4, 5, 6, 7]) attendanceByDate.set(day(d), full());
    const r = classifyMonth(MONTH, YEAR, flexible({ attendanceByDate }));
    expect(r.presentDays + r.compensationDays).toBe(7);
    expect(r.payableDays).toBe(7);
    // Quota 3, 7 worked: 4 beyond it are compensation.
    expect(r.compensationDays).toBe(4);
  });
});

describe("a part-timer's leave and half-days can never conjure compensation days", () => {
  test("leave + half-days past the quota with no full day worked: no compensation, nothing counted twice", () => {
    // 8-14 June: 3 paid leave days + 3 half days = 4.5 credit against a quota of 3.
    // The old walk counted 1.5 compensation days here although not one full day was
    // worked, on top of the leave and the half-days themselves.
    const attendanceByDate = new Map<string, Att>([
      [day(11), half()],
      [day(12), half()],
      [day(13), half()],
    ]);
    const leaveByDate = leave({ [day(8)]: { paid: 1, unpaid: 0 }, [day(9)]: { paid: 1, unpaid: 0 }, [day(10)]: { paid: 1, unpaid: 0 } });
    const r = classifyMonth(MONTH, YEAR, flexible({ attendanceByDate, leaveByDate }));
    expect(r.compensationDays).toBe(0);
    expect(r.presentDays).toBe(0);
    expect(r.payableDays).toBe(3 + 3 * 0.5);
    expect(r.paidLeaveDays).toBe(3);
  });

  test("a short joining week with only leave days is not turned into compensation", () => {
    // Joined on the 29th: the chunk is 2 days, pro-rated to a quota of 1. Two leave
    // days are 1 more than that quota — still not a compensation day.
    const leaveByDate = leave({ [day(29)]: { paid: 1, unpaid: 0 }, [day(30)]: { paid: 1, unpaid: 0 } });
    const r = classifyMonth(MONTH, YEAR, flexible({ leaveByDate, dateOfJoining: new Date("2026-06-29T00:00:00.000Z") }));
    expect(r.compensationDays).toBe(0);
    expect(r.payableDays).toBe(2);
  });
});

describe("a part-timer's unpaid leave is not also an absence", () => {
  test("a quota shortfall explained by unpaid leave is counted once", () => {
    // Quota 3, one full day worked, two unpaid leave days: shortfall 2, both explained.
    const attendanceByDate = new Map<string, Att>([[day(8), full()]]);
    const leaveByDate = leave({ [day(9)]: { paid: 0, unpaid: 1 }, [day(10)]: { paid: 0, unpaid: 1 } });
    const r = classifyMonth(MONTH, YEAR, flexible({ attendanceByDate, leaveByDate }));
    expect(r.unpaidLeaveDays).toBe(2);
    // Week 8-14 June contributes no absence; every other week of the month is untouched.
    const baseline = classifyMonth(MONTH, YEAR, flexible({ attendanceByDate }));
    expect(baseline.absentDays - r.absentDays).toBe(2);
    expect(r.payableDays).toBe(1);
  });

  test("unpaid leave beyond the shortfall doesn't erase an absence that isn't there", () => {
    const attendanceByDate = new Map<string, Att>([[day(8), full()], [day(9), full()]]);
    const leaveByDate = leave({ [day(10)]: { paid: 0, unpaid: 1 }, [day(11)]: { paid: 0, unpaid: 1 } });
    const r = classifyMonth(MONTH, YEAR, flexible({ attendanceByDate, leaveByDate }));
    const baseline = classifyMonth(MONTH, YEAR, flexible({ attendanceByDate }));
    // Quota 3, two worked: shortfall 1, explained by one of the two unpaid days.
    expect(baseline.absentDays - r.absentDays).toBe(1);
  });
});

describe("half-day leave — fixed schedule", () => {
  const baseline = classifyMonth(MONTH, YEAR, fixed());

  test("a half-day paid leave with nothing else that day: half paid, half absent", () => {
    const r = classifyMonth(MONTH, YEAR, fixed({ leaveByDate: leave({ [day(3)]: { paid: 0.5, unpaid: 0 } }) }));
    expect(r.paidLeaveDays).toBe(0.5);
    expect(r.absentDays).toBe(baseline.absentDays - 0.5);
    expect(entryOf(r, 3)).toMatchObject({ status: "paid_leave", credit: 0.5, leavePaid: 0.5, absentPart: 0.5 });
    expect(r.payableDays).toBe(0.5);
    // A half-absent day is not a whole absent day a credit could cover.
    expect(r.absentDates.map((d) => d.toISOString().slice(0, 10))).not.toContain(day(3));
    expect(r.workingDaysElapsed).toBe(baseline.workingDaysElapsed);
  });

  test("a half-day leave plus a half day worked is one full day — neither lost nor doubled", () => {
    const r = classifyMonth(
      MONTH,
      YEAR,
      fixed({ attendanceByDate: new Map([[day(3), half()]]), leaveByDate: leave({ [day(3)]: { paid: 0.5, unpaid: 0 } }) }),
    );
    expect(r.halfDays).toBe(1);
    expect(r.paidLeaveDays).toBe(0.5);
    expect(entryOf(r, 3)).toMatchObject({ status: "half_day", credit: 1, leavePaid: 0.5 });
    expect(r.payableDays).toBe(1);
    // Nothing of that day is absent.
    expect(r.absentDays).toBe(baseline.absentDays - 1);
  });

  test("a half-day leave on a day worked in full is not needed and is not counted", () => {
    const r = classifyMonth(
      MONTH,
      YEAR,
      fixed({ attendanceByDate: new Map([[day(3), full()]]), leaveByDate: leave({ [day(3)]: { paid: 0.5, unpaid: 0 } }) }),
    );
    expect(r.paidLeaveDays).toBe(0);
    expect(entryOf(r, 3)).toMatchObject({ status: "present", credit: 1 });
    expect(entryOf(r, 3).leavePaid).toBeUndefined();
    expect(r.payableDays).toBe(1);
  });

  test("a paid half and an unpaid half on one day: no part of it is absent", () => {
    const r = classifyMonth(MONTH, YEAR, fixed({ leaveByDate: leave({ [day(3)]: { paid: 0.5, unpaid: 0.5 } }) }));
    expect(r.paidLeaveDays).toBe(0.5);
    expect(r.unpaidLeaveDays).toBe(0.5);
    expect(r.absentDays).toBe(baseline.absentDays - 1);
    expect(entryOf(r, 3).absentPart).toBeUndefined();
    expect(r.payableDays).toBe(0.5);
  });

  test("a half-day unpaid leave with nothing else: half unpaid, half absent, nothing paid", () => {
    const r = classifyMonth(MONTH, YEAR, fixed({ leaveByDate: leave({ [day(3)]: { paid: 0, unpaid: 0.5 } }) }));
    expect(r.unpaidLeaveDays).toBe(0.5);
    expect(r.absentDays).toBe(baseline.absentDays - 0.5);
    expect(r.payableDays).toBe(0);
  });

  test("a whole-day leave on a half-day worked fills the other half — the leave day is not lost", () => {
    // The old walk ignored leave on any day with a record: this day paid 0.5 while the
    // approved leave still came off the employee's balance.
    const r = classifyMonth(
      MONTH,
      YEAR,
      fixed({ attendanceByDate: new Map([[day(3), half()]]), leaveByDate: leave({ [day(3)]: { paid: 1, unpaid: 0 } }) }),
    );
    expect(entryOf(r, 3)).toMatchObject({ status: "half_day", credit: 1, leavePaid: 0.5 });
    expect(r.paidLeaveDays).toBe(0.5);
    expect(r.payableDays).toBe(1);
  });

  test("a whole-day leave on a zero-hour record counts as leave, not an absence", () => {
    const r = classifyMonth(
      MONTH,
      YEAR,
      fixed({ attendanceByDate: new Map([[day(3), full(0)]]), leaveByDate: leave({ [day(3)]: { paid: 1, unpaid: 0 } }) }),
    );
    expect(entryOf(r, 3)).toMatchObject({ status: "paid_leave", credit: 1 });
  });

  test("a holiday stays a holiday however much leave covers it", () => {
    const r = classifyMonth(
      MONTH,
      YEAR,
      fixed({ holidayDates: new Set([day(3)]), leaveByDate: leave({ [day(3)]: { paid: 1, unpaid: 0 } }) }),
    );
    expect(entryOf(r, 3)).toMatchObject({ status: "holiday", credit: 1 });
    expect(r.paidLeaveDays).toBe(0);
  });

  test("leave on the weekly off day is the weekly off, not leave", () => {
    const r = classifyMonth(MONTH, YEAR, fixed({ leaveByDate: leave({ [day(7)]: { paid: 1, unpaid: 0 } }) }));
    expect(entryOf(r, 7).status).toBe("weekly_off");
    expect(r.paidLeaveDays).toBe(0);
  });

  test("the legacy whole-day leave map still works", () => {
    const r = classifyMonth(MONTH, YEAR, fixed({ leaveTypeByDate: new Map([[day(3), "leave_casual" as never]]) }));
    expect(r.paidLeaveDays).toBe(1);
    expect(entryOf(r, 3).status).toBe("paid_leave");
  });
});

describe("half-day leave — part-time schedule", () => {
  test("a half-day paid leave counts half toward the weekly quota", () => {
    // Quota 3: 2 full days + a half day of leave = 2.5 credit -> shortfall 0.5.
    const attendanceByDate = new Map<string, Att>([[day(8), full()], [day(9), full()]]);
    const withLeave = classifyMonth(MONTH, YEAR, flexible({ attendanceByDate, leaveByDate: leave({ [day(10)]: { paid: 0.5, unpaid: 0 } }) }));
    const without = classifyMonth(MONTH, YEAR, flexible({ attendanceByDate }));
    expect(without.absentDays - withLeave.absentDays).toBe(0.5);
    expect(withLeave.paidLeaveDays).toBe(0.5);
    expect(withLeave.payableDays).toBe(2.5);
  });

  test("a half-day leave + a half day worked is one full day toward the quota", () => {
    const r = classifyMonth(
      MONTH,
      YEAR,
      flexible({ attendanceByDate: new Map([[day(10), half()]]), leaveByDate: leave({ [day(10)]: { paid: 0.5, unpaid: 0 } }) }),
    );
    expect(entryOf(r, 10)).toMatchObject({ status: "half_day", credit: 1 });
    expect(r.payableDays).toBe(1);
  });
});

describe("today is not final — a day still open is never 'absent'", () => {
  // Wed 17 June 2026, noon (local fields: the walk reads them the way todayDateOnly does).
  const today = new Date(2026, 5, 17, 12, 0, 0);
  const open: Att = { hasClockIn: true, isHalfDay: false, isCompensation: false, totalHours: 0, isOpen: true };

  test("an approved device day still open (0 hours so far) is live, not absent", () => {
    // The 2026-10-01 bug: a device punch auto-approves the day at once with 0 hours
    // until the session closes, which the walk read as a zero-hour (absent) day.
    const r = classifyMonth(MONTH, YEAR, fixed({ today, attendanceByDate: new Map([[day(17), open]]) }));
    expect(entryOf(r, 17)).toMatchObject({ status: "live", credit: 0 });
    expect(r.days.some((d) => d.date === day(17) && d.status === "absent")).toBe(false);
  });

  test("a live day adds nothing to any tile or to pay until it closes", () => {
    const without = classifyMonth(MONTH, YEAR, fixed({ today }));
    const live = classifyMonth(MONTH, YEAR, fixed({ today, attendanceByDate: new Map([[day(17), open]]) }));
    // Not present yet, not paid yet — and not absent: today is excluded from the
    // absences whether or not the employee has clocked in.
    expect(live.presentDays).toBe(0);
    expect(live.payableDays).toBe(0);
    expect(live.absentDays).toBe(without.absentDays);
  });

  test("today with nothing recorded yet is 'today', not an absence — yesterday still is", () => {
    const r = classifyMonth(MONTH, YEAR, fixed({ today }));
    expect(entryOf(r, 17).status).toBe("today");
    expect(entryOf(r, 16).status).toBe("absent");
    // The walk stops at today.
    expect(r.days.at(-1)!.date).toBe(day(17));
    expect(r.absentDates.map((d) => d.toISOString().slice(0, 10))).not.toContain(day(17));
  });

  test("the day counts once the session closes", () => {
    const closed: Att = { hasClockIn: true, isHalfDay: false, isCompensation: false, totalHours: 8, isOpen: false };
    const r = classifyMonth(MONTH, YEAR, fixed({ today, attendanceByDate: new Map([[day(17), closed]]) }));
    expect(entryOf(r, 17)).toMatchObject({ status: "present", credit: 1 });
  });

  test("a day that was never closed in the past is judged by its hours as before", () => {
    // Only *today* can be live — a forgotten clock-out last week is not 'live'.
    const stale: Att = { hasClockIn: true, isHalfDay: false, isCompensation: false, totalHours: 0, isOpen: true };
    const r = classifyMonth(MONTH, YEAR, fixed({ today, attendanceByDate: new Map([[day(10), stale]]) }));
    expect(entryOf(r, 10).status).toBe("absent");
  });

  test("today on the week's off day while open is live, not a compensation day yet", () => {
    const sunday = new Date(2026, 5, 14, 12, 0, 0); // 14 June is a Sunday
    // Claim the Sunday as that week's off, so a clock-in on it would be compensation.
    const r = classifyMonth(
      MONTH,
      YEAR,
      fixed({
        today: sunday,
        attendanceByDate: new Map([[day(14), open]]),
        movedOffDateByWeek: new Map([[day(8), day(14)]]),
      }),
    );
    expect(entryOf(r, 14).status).toBe("live");
    expect(r.compensationDays).toBe(0);
    // Once it closes it is a compensation day.
    const closed: Att = { hasClockIn: true, isHalfDay: false, isCompensation: false, totalHours: 8, isOpen: false };
    const done = classifyMonth(
      MONTH,
      YEAR,
      fixed({
        today: sunday,
        attendanceByDate: new Map([[day(14), closed]]),
        movedOffDateByWeek: new Map([[day(8), day(14)]]),
      }),
    );
    expect(entryOf(done, 14)).toMatchObject({ status: "compensation", credit: 1 });
  });

  test("part-time: an open day is live, and a half-day so far is not mistaken for absence", () => {
    const r = classifyMonth(MONTH, YEAR, flexible({ today, attendanceByDate: new Map([[day(17), open]]) }));
    expect(entryOf(r, 17).status).toBe("live");
    const none = classifyMonth(MONTH, YEAR, flexible({ today }));
    expect(entryOf(none, 17).status).toBe("today");
  });

  test("part-time: today still counts as a day left in the week, so the quota isn't written off early", () => {
    // Saturday 20 June, quota 3. Monday worked in full (credit 1). Left: today and
    // Sunday. 1 + 1 (today) + 1 (Sunday) = 3 — still reachable, so no shortfall is
    // 'unavoidable' yet. The weeks of 1-7 and 8-14 June are over with nothing worked:
    // 3 + 3 absent. If today were not counted as a day left, the quota would read as
    // already lost and the total would be 7.
    const sat = new Date(2026, 5, 20, 12, 0, 0);
    const worked = new Map<string, Att>([[day(15), full()]]);
    const todayOpen = classifyMonth(MONTH, YEAR, flexible({ today: sat, attendanceByDate: new Map([...worked, [day(20), open]]) }));
    const todayNotStarted = classifyMonth(MONTH, YEAR, flexible({ today: sat, attendanceByDate: worked }));
    expect(todayOpen.absentDays).toBe(6);
    expect(todayNotStarted.absentDays).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Randomised invariants. For hundreds of random months, the engine's answers must
// satisfy the properties that mean "counted once, nothing lost":
//   1. tiles == the calendar's own days;
//   2. pay credit == sum of the days' credits == the paid-day formula;
//   3. pay credit == an independent recomputation from the raw records + leave;
//   4. no day is worth more than one day (a compensation day is exactly one).
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomMonth(seed: number, isFlexible: boolean) {
  const rnd = mulberry32(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const attendanceByDate = new Map<string, Att>();
  const leaveByDate = new Map<string, LeaveDayEntry>();
  const holidayDates = new Set<string>();
  const flaggedComp = new Set<string>();
  for (let d = 1; d <= 30; d++) {
    const r = rnd();
    if (r < 0.55) {
      const kind = pick(["full", "full", "half", "zero", "open"]);
      const att: Att =
        kind === "full"
          ? { hasClockIn: true, isHalfDay: false, isCompensation: false, totalHours: 5 + Math.floor(rnd() * 8) }
          : kind === "half"
            ? { hasClockIn: true, isHalfDay: true, isCompensation: false, totalHours: 1 + Math.floor(rnd() * 3) }
            : kind === "zero"
              ? { hasClockIn: true, isHalfDay: false, isCompensation: false, totalHours: 0 }
              : { hasClockIn: true, isHalfDay: false, isCompensation: false, totalHours: null };
      if (rnd() < 0.05 && kind !== "zero") {
        att.isCompensation = true;
        flaggedComp.add(day(d));
      }
      attendanceByDate.set(day(d), att);
    }
    if (rnd() < 0.18) {
      const kind = pick(["paid", "paid_half", "unpaid", "unpaid_half", "mix"]);
      const m = new Map<string, LeaveDayEntry>();
      if (kind === "paid") addLeaveToDay(m, day(d), "leave_sick", false);
      if (kind === "paid_half") addLeaveToDay(m, day(d), "leave_casual", true);
      if (kind === "unpaid") addLeaveToDay(m, day(d), "leave_unpaid", false);
      if (kind === "unpaid_half") addLeaveToDay(m, day(d), "leave_unpaid", true);
      if (kind === "mix") {
        addLeaveToDay(m, day(d), "leave_casual", true);
        addLeaveToDay(m, day(d), "leave_unpaid", true);
      }
      leaveByDate.set(day(d), m.get(day(d))!);
    }
    if (rnd() < 0.05) holidayDates.add(day(d));
  }
  // A claimed off day for every week keeps the weekly off deterministic for the oracle.
  const movedOffDateByWeek = new Map<string, string>();
  for (const monday of [1, 8, 15, 22, 29]) {
    const off = monday + Math.floor(rnd() * 7);
    if (off <= 30 + 6) movedOffDateByWeek.set(day(monday), day(Math.min(off, 30 + 0)));
  }
  // weekStart keys are real Mondays; June 1 2026 is a Monday.
  const base = isFlexible ? flexible : fixed;
  return {
    lookups: base({ attendanceByDate, leaveByDate, holidayDates, movedOffDateByWeek }),
    attendanceByDate,
    leaveByDate,
    holidayDates,
    flaggedComp,
    movedOffDateByWeek,
  };
}

function oracle(
  isFlexible: boolean,
  m: ReturnType<typeof randomMonth>,
): { pay: number; absent: number } {
  const offDates = new Set(m.movedOffDateByWeek.values());
  let pay = 0;
  let absent = 0;
  for (let d = 1; d <= 30; d++) {
    const k = day(d);
    const att = m.attendanceByDate.get(k);
    const has = !!att?.hasClockIn;
    if (!isFlexible && offDates.has(k)) {
      if (has) pay += 1;
      continue;
    }
    if (att?.isCompensation) {
      pay += 1;
      continue;
    }
    if (m.holidayDates.has(k)) {
      pay += 1;
      continue;
    }
    const w = has ? dayCredit(att!.totalHours, att!.isHalfDay) : 0;
    const lv = m.leaveByDate.get(k);
    const room = 1 - w;
    const paid = Math.min(lv?.paid ?? 0, room);
    const unpaid = Math.min(lv?.unpaid ?? 0, room - paid);
    pay += w + paid;
    if (!isFlexible && w === 0) absent += 1 - paid - unpaid;
  }
  return { pay, absent };
}

describe("randomised invariants (500 months)", () => {
  for (const isFlexible of [false, true]) {
    test(`${isFlexible ? "part-time" : "fixed-schedule"}: counted once, nothing lost`, () => {
      for (let seed = 1; seed <= 250; seed++) {
        const m = randomMonth(seed, isFlexible);
        const r = classifyMonth(MONTH, YEAR, m.lookups);
        const tag = `seed ${seed}`;
        const count = (s: string) => r.days.filter((d) => d.status === s).length;

        // 1. Tiles are the calendar's days.
        expect({ tag, v: r.presentDays }).toEqual({ tag, v: count("present") });
        expect({ tag, v: r.halfDays }).toEqual({ tag, v: count("half_day") });
        expect({ tag, v: r.compensationDays }).toEqual({ tag, v: count("compensation") });
        expect({ tag, v: r.holidayDays }).toEqual({ tag, v: count("holiday") });

        // 2. One pay figure, three ways.
        const formula = r.presentDays + r.halfDays * 0.5 + r.paidLeaveDays + r.holidayDays + r.compensationDays;
        const summed = r.days.reduce((a, d) => a + d.credit, 0);
        expect({ tag, v: r.payableDays }).toEqual({ tag, v: summed });
        expect({ tag, v: r.payableDays }).toEqual({ tag, v: formula });

        // 3. Against an independent recomputation from the raw inputs.
        const o = oracle(isFlexible, m);
        expect({ tag, v: r.payableDays }).toEqual({ tag, v: o.pay });
        if (!isFlexible) expect({ tag, v: r.absentDays }).toEqual({ tag, v: o.absent });

        // 4. No day is worth more than a day; leave never double-counts a worked day.
        for (const d of r.days) {
          expect(d.credit).toBeLessThanOrEqual(1);
          expect(d.credit).toBeGreaterThanOrEqual(0);
          if (d.status === "present") expect(d.leavePaid ?? 0).toBe(0);
        }

        // Whole-day counts for the three worked tiles.
        for (const v of [r.presentDays, r.halfDays, r.compensationDays, r.holidayDays]) {
          expect(Number.isInteger(v)).toBe(true);
        }

        // Every approved day with hours is counted exactly once, as worked, unless a
        // holiday takes precedence. (Open records have unknown hours: also worked.)
        for (const [k, att] of m.attendanceByDate) {
          const hours = att.totalHours;
          if (hours === 0 || (hours != null && hours <= 0)) continue;
          const status = r.days.find((x) => x.date === k)?.status;
          const onOffDay = !isFlexible && [...m.movedOffDateByWeek.values()].includes(k);
          if (m.holidayDates.has(k) && !onOffDay && !att.isCompensation) {
            expect(status).toBe("holiday");
          } else {
            expect(["present", "half_day", "compensation"]).toContain(status as string);
          }
        }
      }
    });
  }
});

describe("daysWorked and weeklyOffDays (monthly overview columns)", () => {
  test("daysWorked = present + half×0.5 + compensation; weeklyOffDays = the calendar's weekly_off days", () => {
    // June 2026, Sunday default off. Mon–Wed full, Thu half, and the second Sunday (14th)
    // worked: that week's off was resolved elsewhere or the 14th is a comp day — either
    // way the invariants below must hold against the same walk.
    const attendanceByDate = new Map<string, Att>([
      [day(1), full()],
      [day(2), full()],
      [day(3), full()],
      [day(4), half()],
      [day(8), full()],
      [day(9), full()],
      [day(10), full()],
      [day(11), full()],
      [day(12), full()],
      [day(13), full()],
      [day(14), full()],
    ]);
    const r = classifyMonth(MONTH, YEAR, fixed({ attendanceByDate }));
    expect(r.daysWorked).toBe(r.presentDays + r.halfDays * 0.5 + r.compensationDays);
    // 3 + 7 = 10 full days and 1 half day were worked, none lost or doubled.
    expect(r.daysWorked).toBe(10 + 0.5);
    expect(r.weeklyOffDays).toBe(r.days.filter((d) => d.status === "weekly_off").length);
    expect(r.weeklyOffDays).toBeGreaterThan(0);
  });

  test("leave and holidays are paid but are not days worked", () => {
    const r = classifyMonth(
      MONTH,
      YEAR,
      fixed({
        attendanceByDate: new Map<string, Att>([[day(1), full()]]),
        holidayDates: new Set([day(2)]),
        leaveByDate: leave({ [day(3)]: { paid: 1, unpaid: 0 } }),
      }),
    );
    expect(r.daysWorked).toBe(1);
    expect(r.holidayDays).toBe(1);
    expect(r.paidLeaveDays).toBe(1);
  });
});
