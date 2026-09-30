import { describe, expect, test } from "bun:test";
import { resolveWeekOff, type WeekOffInputs } from "./weekly-off";
import { classifyMonth } from "./monthly-breakdown";

// Week of Mon 8 June 2026 .. Sun 14 June 2026. Default off day: Sunday (14th).
const weekStart = new Date("2026-06-08T00:00:00.000Z");
const d = (n: number) => `2026-06-${String(n).padStart(2, "0")}`;

function inputs(over: Partial<WeekOffInputs> = {}): WeekOffInputs {
  return {
    weekStart,
    defaultOffDay: 0,
    explicitOffDate: null,
    workedDates: new Set<string>(),
    holidayDates: new Set<string>(),
    leaveDates: new Set<string>(),
    declaredUnpaidDates: new Set<string>(),
    todayKey: "2026-06-30", // the whole week is in the past
    joinKey: null,
    ...over,
  };
}
const worked = (...days: number[]) => new Set(days.map(d));

describe("resolveWeekOff", () => {
  test("default day stays the off when the employee stays home on it", () => {
    // Skipped Wednesday but did not work Sunday: Sunday is the off, Wed is absent.
    const r = resolveWeekOff(inputs({ workedDates: worked(8, 9, 11, 12, 13) }));
    expect(r).toMatchObject({ date: d(14), kind: "default" });
  });

  test("worked the default day and skipped another: the skipped day is the automatic off", () => {
    const r = resolveWeekOff(inputs({ workedDates: worked(8, 9, 11, 12, 13, 14) })); // no 10th
    expect(r).toMatchObject({ date: d(10), kind: "auto", provisional: false });
  });

  test("worked all seven days: no automatic off, the default day stays (a compensation day)", () => {
    const r = resolveWeekOff(inputs({ workedDates: worked(8, 9, 10, 11, 12, 13, 14) }));
    expect(r).toMatchObject({ date: d(14), kind: "default" });
  });

  test("an explicit claim always wins", () => {
    const r = resolveWeekOff(inputs({ explicitOffDate: d(12), workedDates: worked(8, 9, 11, 13, 14) }));
    expect(r).toMatchObject({ date: d(12), kind: "claimed" });
  });

  test("an approved leave, a holiday or a declared-unpaid day is not an unexplained no-show", () => {
    const base = { workedDates: worked(8, 9, 11, 12, 13, 14) }; // 10th missing
    expect(resolveWeekOff(inputs({ ...base, leaveDates: new Set([d(10)]) })).kind).toBe("default");
    expect(resolveWeekOff(inputs({ ...base, holidayDates: new Set([d(10)]) })).kind).toBe("default");
    expect(resolveWeekOff(inputs({ ...base, declaredUnpaidDates: new Set([d(10)]) })).kind).toBe("default");
  });

  test("the first unexplained no-show takes the off; a later one stays absent", () => {
    const r = resolveWeekOff(inputs({ workedDates: worked(8, 11, 12, 13, 14) })); // 9th and 10th missing
    expect(r).toMatchObject({ date: d(9), kind: "auto" });
  });

  test("declaring the first no-show unpaid frees the off for the next one", () => {
    const r = resolveWeekOff(
      inputs({ workedDates: worked(8, 11, 12, 13, 14), declaredUnpaidDates: new Set([d(9)]) }),
    );
    expect(r).toMatchObject({ date: d(10), kind: "auto" });
  });

  test("before the default day has arrived the automatic off is provisional", () => {
    // Today is Thursday 11th; Sunday hasn't happened. 10th was a no-show.
    const r = resolveWeekOff(inputs({ todayKey: d(11), workedDates: worked(8, 9) }));
    expect(r).toMatchObject({ date: d(10), kind: "auto", provisional: true });
  });

  test("today is never the automatic off — the day isn't over", () => {
    const r = resolveWeekOff(inputs({ todayKey: d(10), workedDates: worked(8, 9) }));
    expect(r).toMatchObject({ date: d(14), kind: "default" });
  });

  test("days before the joining date are not no-shows", () => {
    const r = resolveWeekOff(inputs({ workedDates: worked(10, 11, 12, 13, 14), joinKey: d(10) }));
    expect(r).toMatchObject({ date: d(14), kind: "default" }); // 8th/9th pre-date joining
  });

  test("honours a non-Sunday default off day", () => {
    // Off day Wednesday (3): worked Wednesday, skipped Monday -> Monday is the off.
    const r = resolveWeekOff(inputs({ defaultOffDay: 3, workedDates: worked(9, 10, 11, 12, 13, 14) }));
    expect(r).toMatchObject({ date: d(8), kind: "auto" });
  });
});

describe("classifyMonth — automatic weekly off", () => {
  type Att = { hasClockIn: boolean; isHalfDay: boolean; isCompensation: boolean; totalHours: number | null };
  const present: Att = { hasClockIn: true, isHalfDay: false, isCompensation: false, totalHours: 8 };
  function lookups(worked: number[], over: Record<string, unknown> = {}) {
    const attendanceByDate = new Map<string, Att>();
    for (const n of worked) attendanceByDate.set(d(n), present);
    return {
      attendanceByDate,
      leaveTypeByDate: new Map(),
      holidayDates: new Set<string>(),
      defaultOffDay: 0,
      movedOffDateByWeek: new Map<string, string>(),
      employmentType: "fulltime" as const,
      requiredDaysPerWeek: null,
      today: new Date(2026, 6, 15), // July 15: June is fully in the past
      ...over,
    };
  }
  // Work every day of June except the listed ones.
  const allBut = (...skip: number[]) =>
    Array.from({ length: 30 }, (_, i) => i + 1).filter((n) => !skip.includes(n));

  test("a no-show in a week where the Sunday was worked is a weekly off, and the Sunday is an ordinary day", () => {
    // June 2026 Sundays: 7, 14, 21, 28. Skip Wed 10th, work every Sunday.
    const r = classifyMonth(6, 2026, lookups(allBut(10)));
    expect(r.absentDays).toBe(0);
    const tenth = r.days.find((x) => x.date === d(10))!;
    expect(tenth.status).toBe("weekly_off");
    expect(tenth.note).toBe("auto_off");
    // The 14th was worked and is no longer the off: present, not compensation.
    expect(r.days.find((x) => x.date === d(14))!.status).toBe("present");
    // The other three Sundays had nothing to give the off to: compensation.
    expect(r.compensationDays).toBe(3);
  });

  test("the same no-show is absent when the Sunday is not worked", () => {
    const r = classifyMonth(6, 2026, lookups(allBut(10, 14)));
    expect(r.absentDays).toBe(1);
    expect(r.days.find((x) => x.date === d(10))!.status).toBe("absent");
    expect(r.days.find((x) => x.date === d(14))!.status).toBe("weekly_off");
  });

  test("a day the employee switched to unpaid is an unpaid day, and frees the off", () => {
    const r = classifyMonth(6, 2026, lookups(allBut(10), { declaredUnpaidDates: new Set([d(10)]) }));
    const tenth = r.days.find((x) => x.date === d(10))!;
    expect(tenth.status).toBe("unpaid_leave");
    expect(tenth.note).toBe("declared_unpaid");
    expect(r.unpaidLeaveDays).toBe(1);
    // With nothing left to take the off, the worked Sunday is compensation again.
    expect(r.days.find((x) => x.date === d(14))!.status).toBe("compensation");
    expect(r.compensationDays).toBe(4);
  });

  test("a week straddling two months resolves the same from either side", () => {
    // 29 June - 5 July 2026: Sunday is 5 July. Skip Tue 30 June, work Sunday 5 July.
    const june = classifyMonth(6, 2026, lookups(allBut(30).concat([]), {
      attendanceByDate: (() => {
        const m = new Map<string, Att>();
        for (const n of allBut(30)) m.set(d(n), present);
        m.set("2026-07-05", present); // the Sunday lives in July's half of the week
        return m;
      })(),
    }));
    expect(june.absentDays).toBe(0);
    expect(june.days.find((x) => x.date === d(30))!.status).toBe("weekly_off");
  });
});
