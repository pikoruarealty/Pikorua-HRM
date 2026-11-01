import { describe, expect, test } from "bun:test";
import { groupMadeUp, madeUpSentence, matchExtraDays, pickBankedDay, type MissedUnit } from "./extra-days";
import { buildExtraDayLedger, classifyMonth } from "./monthly-breakdown";

// 2026-11-01 owner rule (lib/attendance/extra-days.ts): an extra day is paid once —
// either it makes up an earlier missed day (compensation, paid where it is worked) or
// it is banked as a balance day (present, worth 0 now, usable on a later missed day).

const absent = (date: string, location: "office" | "wfh" = "office"): MissedUnit => ({
  id: date,
  date,
  kind: "absence",
  location,
});

describe("matchExtraDays", () => {
  test("an extra day after a missed day makes it up; with nothing to make up it is banked", () => {
    const r = matchExtraDays({
      missed: [absent("2026-10-06")],
      extras: [{ date: "2026-10-18", location: "office" }, { date: "2026-10-25", location: "office" }],
      todayKey: "2026-11-01",
    });
    expect(r.verdicts.get("2026-10-18")).toMatchObject({ kind: "compensation", missed: { date: "2026-10-06" } });
    expect(r.verdicts.get("2026-10-25")).toMatchObject({ kind: "banked", status: "available", expires: "2026-12-24" });
    expect(r.madeUpOn.get("2026-10-06")).toBe("2026-10-18");
    expect(r.bank.map((b) => b.date)).toEqual(["2026-10-25"]);
  });

  test("an extra day never makes up a LATER missed day (that needs a balance-day request)", () => {
    const r = matchExtraDays({
      missed: [absent("2026-10-20")],
      extras: [{ date: "2026-10-04", location: "office" }],
      todayKey: "2026-11-01",
    });
    expect(r.verdicts.get("2026-10-04")?.kind).toBe("banked");
    expect(r.madeUpOn.size).toBe(0);
  });

  test("oldest missed day first, absences before unpaid-leave days, one each", () => {
    const r = matchExtraDays({
      missed: [
        { id: "2026-09-10", date: "2026-09-10", kind: "unpaid_leave", location: "office" },
        absent("2026-09-20"),
        absent("2026-09-15"),
      ],
      extras: [
        { date: "2026-10-04", location: "office" },
        { date: "2026-10-11", location: "office" },
        { date: "2026-10-18", location: "office" },
      ],
      todayKey: "2026-11-01",
    });
    expect([...r.madeUpOn.entries()]).toEqual([
      ["2026-09-15", "2026-10-04"],
      ["2026-09-20", "2026-10-11"],
      ["2026-09-10", "2026-10-18"],
    ]);
  });

  test("more than 60 days back is out of reach", () => {
    const r = matchExtraDays({
      missed: [absent("2026-08-01")],
      extras: [{ date: "2026-10-04", location: "office" }],
      todayKey: "2026-11-01",
    });
    expect(r.verdicts.get("2026-10-04")?.kind).toBe("banked");
  });

  test("a WFH day cannot make up a missed office day", () => {
    const r = matchExtraDays({
      missed: [absent("2026-10-06", "office")],
      extras: [{ date: "2026-10-18", location: "wfh" }],
      todayKey: "2026-11-01",
    });
    expect(r.verdicts.get("2026-10-18")).toMatchObject({ kind: "banked", location: "wfh" });
  });

  test("a balance day already spent by an approved request stays banked and used", () => {
    const r = matchExtraDays({
      missed: [absent("2026-10-01")],
      extras: [{ date: "2026-10-04", location: "office" }],
      usedBalance: new Map([["2026-10-04", "2026-10-14"]]),
      todayKey: "2026-11-01",
    });
    expect(r.verdicts.get("2026-10-04")).toMatchObject({ kind: "banked", status: "used", usedFor: "2026-10-14" });
    expect(r.madeUpOn.size).toBe(0);
  });

  test("an unused balance day past its 60 days is expired", () => {
    const r = matchExtraDays({ missed: [], extras: [{ date: "2026-10-04", location: "office" }], todayKey: "2026-12-04" });
    expect(r.bank[0]).toMatchObject({ status: "expired", expires: "2026-12-03" });
  });

  test("pickBankedDay: earned on/before the day, inside its window, soonest expiry first", () => {
    const bank = matchExtraDays({
      missed: [],
      extras: [
        { date: "2026-10-04", location: "office" },
        { date: "2026-10-11", location: "office" },
        { date: "2026-10-25", location: "office" },
      ],
      todayKey: "2026-11-01",
    }).bank;
    expect(pickBankedDay(bank, "2026-10-20", "office")?.date).toBe("2026-10-04");
    expect(pickBankedDay(bank, "2026-10-01", "office")).toBeNull();
  });
});

// --- The walk, through the ledger -------------------------------------------------
// 2026: 1 Oct is a Thursday; Sundays 4/11/18/25 Oct, 6/13/20/27 Sep. A full-timer
// with Sunday off who works every Monday-Saturday from August unless told otherwise.

type Att = {
  hasClockIn: boolean;
  isHalfDay: boolean;
  isCompensation: boolean;
  totalHours: number | null;
  location?: "office" | "wfh";
};
const full = (location: "office" | "wfh" = "office"): Att => ({
  hasClockIn: true,
  isHalfDay: false,
  isCompensation: false,
  totalHours: 8,
  location,
});
const key = (d: Date) => d.toISOString().slice(0, 10);
const NOW = new Date("2026-11-01T06:30:00.000Z");

function fullTimer(opts: { skip?: string[]; sundays?: string[]; balance?: Record<string, string> }) {
  const att = new Map<string, Att>();
  for (let t = Date.UTC(2026, 7, 1); t <= Date.UTC(2026, 9, 31); t += 86_400_000) {
    const d = new Date(t);
    const k = key(d);
    if (d.getUTCDay() === 0) {
      if (opts.sundays?.includes(k)) att.set(k, full());
      continue;
    }
    if (!opts.skip?.includes(k)) att.set(k, full());
  }
  const balance = opts.balance ?? {};
  return {
    attendanceByDate: att,
    holidayDates: new Set<string>(),
    defaultOffDay: 0,
    movedOffDateByWeek: new Map<string, string>(),
    employmentType: "fulltime" as const,
    requiredDaysPerWeek: null,
    dateOfJoining: new Date("2026-06-01T00:00:00.000Z"),
    balanceDates: new Set(Object.keys(balance)),
    balanceEarnedFor: new Map(Object.entries(balance)),
    extraRuleFrom: "2026-10-01",
  };
}

function month(m: number, lookups: ReturnType<typeof fullTimer> | Record<string, unknown>) {
  const l = lookups as Parameters<typeof classifyMonth>[2];
  const ledger = buildExtraDayLedger(l, NOW);
  return classifyMonth(m, 2026, { ...l, extraVerdicts: ledger.verdicts, madeUpOn: ledger.madeUpOn, today: NOW });
}
const at = (r: ReturnType<typeof classifyMonth>, date: string) => r.days.find((d) => d.date === date)!;

/** Pay is the sum of the days' values, and the tiles add up to it. */
function expectConsistent(r: ReturnType<typeof classifyMonth>) {
  const summed = r.days.reduce((a, d) => a + d.credit, 0);
  expect(r.payableDays).toBe(summed);
  expect(r.payableDays).toBe(
    r.presentDays + r.halfDays * 0.5 + r.paidLeaveDays + r.holidayDays + r.compensationDays - r.unpaidWorkDays,
  );
}

describe("full-timer: a worked weekly off under the rule", () => {
  test("with nothing to make up: present, banked, worth 0 — not paid as an extra day", () => {
    const r = month(10, fullTimer({ sundays: ["2026-10-04"] }));
    expect(at(r, "2026-10-04")).toMatchObject({ status: "present", note: "advance", banked: true, credit: 0 });
    expect(r.bankedDays).toBe(1);
    expect(r.advanceDays).toBe(1);
    expect(r.compensationDays).toBe(0);
    const plain = month(10, fullTimer({}));
    expect(r.payableDays).toBe(plain.payableDays);
    expect(r.presentDays).toBe(plain.presentDays + 1);
    expectConsistent(r);
  });

  test("after an absence this month: it makes the absence up, paid once", () => {
    const r = month(10, fullTimer({ skip: ["2026-10-06"], sundays: ["2026-10-18"] }));
    expect(at(r, "2026-10-06")).toMatchObject({ status: "absent", credit: 0, madeUpOn: "2026-10-18" });
    expect(at(r, "2026-10-18")).toMatchObject({
      status: "compensation",
      credit: 1,
      madeUpFor: { date: "2026-10-06", kind: "absence" },
    });
    expect(r.absentDays).toBe(1);
    expect(r.compensationDays).toBe(1);
    expect(r.bankedDays).toBe(0);
    // Net: same pay as a month with no absence and no extra day.
    expect(r.payableDays).toBe(month(10, fullTimer({})).payableDays);
    expectConsistent(r);
  });

  test("last month's absence made up this month: paid in October, noted in both months", () => {
    const l = fullTimer({ skip: ["2026-09-15"], sundays: ["2026-10-04"] });
    const oct = month(10, l);
    const sep = month(9, l);
    expect(at(oct, "2026-10-04")).toMatchObject({ status: "compensation", credit: 1, madeUpFor: { date: "2026-09-15" } });
    expect(at(sep, "2026-09-15")).toMatchObject({ status: "absent", credit: 0, madeUpOn: "2026-10-04" });
    expect(sep.madeUp).toEqual([{ missed: expect.objectContaining({ date: "2026-09-15" }), on: "2026-10-04" }]);
    // September's pay is what it was (the absence stays unpaid there).
    expect(sep.payableDays).toBe(month(9, fullTimer({ skip: ["2026-09-15"] })).payableDays);
    expectConsistent(oct);
    expectConsistent(sep);
  });

  test("days before the rule keep the treatment they were paid under", () => {
    const sep = month(9, fullTimer({ sundays: ["2026-09-13"] }));
    expect(at(sep, "2026-09-13")).toMatchObject({ status: "present", note: "advance", credit: 1 });
    expect(sep.bankedDays).toBe(0);
    // Listed for the ledger only as a pre-rule (already paid) day.
    expect(sep.extraDays.every((x) => x.legacy)).toBe(true);
  });

  test("a banked day used on a later absence (approved request): that day is paid, nothing twice", () => {
    const r = month(10, fullTimer({ skip: ["2026-10-14"], sundays: ["2026-10-04"], balance: { "2026-10-14": "2026-10-04" } }));
    expect(at(r, "2026-10-04")).toMatchObject({ status: "present", banked: true, credit: 0, bankUsedFor: "2026-10-14" });
    expect(at(r, "2026-10-14")).toMatchObject({ status: "paid_leave", note: "balance", credit: 1, balanceEarned: "2026-10-04" });
    expect(r.payableDays).toBe(month(10, fullTimer({})).payableDays);
    expectConsistent(r);
  });

  test("without the rule date the old treatment applies (pre-rule unit tests unchanged)", () => {
    const { extraRuleFrom: _drop, ...legacy } = fullTimer({ sundays: ["2026-10-04"] });
    const r = classifyMonth(10, 2026, { ...legacy, today: NOW });
    expect(at(r, "2026-10-04")).toMatchObject({ status: "present", note: "advance", credit: 1 });
  });
});

// A part-timer on 3 days a week. Their extra days are not paid either (owner,
// 2026-11-01): they make up an earlier short week, or they are banked.
function partTimer(
  workedDays: string[],
  balance: Record<string, string> = {},
  holidays: string[] = [],
  extra: { wfh?: string[]; half?: string[] } = {},
) {
  const att = new Map<string, Att>();
  for (const d of workedDays) att.set(d, full());
  for (const d of extra.wfh ?? []) att.set(d, full("wfh"));
  for (const d of extra.half ?? []) att.set(d, { ...full(), isHalfDay: true, totalHours: 4 });
  return {
    ...fullTimer({}),
    holidayDates: new Set(holidays),
    attendanceByDate: att,
    employmentType: "parttime" as never,
    requiredDaysPerWeek: 3,
    balanceDates: new Set(Object.keys(balance)),
    balanceEarnedFor: new Map(Object.entries(balance)),
  };
}

/** Mon-Wed from 1 Aug to 27 Sep, so the weeks before the ones a test is about meet
 *  their quota (an empty history would be all short weeks, which October's extra
 *  days would then make up first). Under the old counting the week of 31 Aug is
 *  split into an August and a September chunk, so it is worked Mon-Thu there. */
function metHistory(): string[] {
  const days: string[] = [];
  for (let t = Date.UTC(2026, 7, 1); t < Date.UTC(2026, 8, 28); t += 86_400_000) {
    const d = new Date(t);
    if ([1, 2, 3].includes(d.getUTCDay())) days.push(key(d));
  }
  return [...days, "2026-08-01", "2026-09-03"];
}

describe("part-timer under the rule", () => {
  // Week of 5 Oct: 2 days (one short). Week of 12 Oct: 4 days (one over).
  const worked = [
    "2026-10-05", "2026-10-06",
    "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15",
    "2026-10-19", "2026-10-20", "2026-10-21",
    "2026-10-26", "2026-10-27", "2026-10-28",
    "2026-09-28", "2026-09-29", "2026-09-30",
  ];

  test("a day over quota after a short week makes that week up — paid once, shown as compensation", () => {
    const r = month(10, partTimer([...metHistory(), ...worked]));
    expect(at(r, "2026-10-15")).toMatchObject({
      status: "compensation",
      credit: 1,
      madeUpFor: { kind: "shortfall", weekStart: "2026-10-05" },
    });
    expect(r.absentDays).toBe(1);
    expect(r.compensationDays).toBe(1);
    expect(r.madeUp).toEqual([{ missed: expect.objectContaining({ weekStart: "2026-10-05" }), on: "2026-10-15" }]);
    expectConsistent(r);
  });

  test("a day over quota with nothing to make up is banked, not paid", () => {
    // Week of 5 Oct now meets its quota (5, 7, 8 Oct); the week of 12 Oct is still one over.
    const r = month(10, partTimer([...metHistory(), ...worked.filter((d) => d !== "2026-10-06"), "2026-10-07", "2026-10-08"]));
    expect(at(r, "2026-10-15")).toMatchObject({ status: "present", banked: true, credit: 0 });
    expect(r.compensationDays).toBe(0);
    expect(r.bankedDays).toBe(1);
    expectConsistent(r);
  });

  test("a week split across two months is judged whole: Mon-Wed met in full is neither extra nor short", () => {
    // Week of 28 Sep: worked 28, 29, 30 Sep (3 of 3), nothing 1-4 Oct.
    const l = partTimer(worked);
    const sep = month(9, l);
    const oct = month(10, l);
    expect(sep.days.filter((d) => d.date >= "2026-09-28").map((d) => d.status)).toEqual(["present", "present", "present"]);
    expect(sep.compensationDays).toBe(0);
    expect(oct.days.filter((d) => d.date <= "2026-10-04").every((d) => d.status === "no_record")).toBe(true);
    // The only October shortfall is the week of 5 Oct (made up on the 15th).
    expect(oct.absentDays).toBe(1);
  });
});

describe("part-timer holidays (owner, 2026-11-01): not part of the quota, not paid", () => {
  // Every week from 28 Sep is worked Mon-Wed except as listed, so it meets its quota.
  const base = [
    "2026-09-28", "2026-09-29", "2026-09-30",
    "2026-10-12", "2026-10-13", "2026-10-14",
    "2026-10-26", "2026-10-27", "2026-10-28",
  ];
  const week = (start: number) => Array.from({ length: 7 }, (_, i) => `2026-10-${String(start + i).padStart(2, "0")}`);

  test("one holiday in a week: still 3 days owed, the holiday is shown but worth nothing", () => {
    const r = month(10, partTimer([...base, "2026-10-05", "2026-10-07", "2026-10-08", ...week(19).slice(0, 3)], {}, ["2026-10-06"]));
    expect(at(r, "2026-10-06")).toMatchObject({ status: "holiday", credit: 0 });
    expect(r.holidayDays).toBe(0);
    // 3 worked around the holiday: quota met exactly — no extra day, nothing short.
    expect(r.compensationDays + r.bankedDays).toBe(0);
    expect(r.absentDays).toBe(0);
    expectConsistent(r);
  });

  test("a whole holiday week owes nothing: the month owes three weeks' days, not four", () => {
    const withWeekOff = month(10, partTimer([...base, "2026-10-05", "2026-10-06", "2026-10-07"], {}, week(19)));
    expect(withWeekOff.absentDays).toBe(0);
    const without = month(10, partTimer([...base, "2026-10-05", "2026-10-06", "2026-10-07", ...week(19).slice(0, 3)]));
    expect(withWeekOff.workingDaysElapsed).toBe(without.workingDaysElapsed - 3);
    expectConsistent(withWeekOff);
  });

  test("five holidays leave two workable days: the week owes two", () => {
    const r = month(10, partTimer([...base, "2026-10-05", "2026-10-06", "2026-10-07"], {}, week(19).slice(0, 5)));
    expect(r.absentDays).toBe(2);
  });

  test("a day worked on a holiday is an ordinary worked day", () => {
    const r = month(10, partTimer([...base, "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-19", "2026-10-20", "2026-10-21"], {}, ["2026-10-20"]));
    expect(at(r, "2026-10-20")).toMatchObject({ status: "present", credit: 1 });
    expect(r.absentDays).toBe(0);
  });
});

describe("part-timer: the quota is office days, and a week pays no more than its quota", () => {
  // Weeks of 28 Sep, 12 Oct, 19 Oct, 26 Oct: exactly 3 office days each.
  const base = [
    "2026-09-28", "2026-09-29", "2026-09-30",
    "2026-10-12", "2026-10-13", "2026-10-14",
    "2026-10-19", "2026-10-20", "2026-10-21",
    "2026-10-26", "2026-10-27", "2026-10-28",
  ];
  const office = ["2026-10-05", "2026-10-06", "2026-10-07"];

  test("a WFH-only day is shown as worked but is not a quota day, not paid, never banked", () => {
    const r = month(10, partTimer([...base, ...office], {}, [], { wfh: ["2026-10-08", "2026-10-09"] }));
    expect(at(r, "2026-10-08")).toMatchObject({ status: "present", note: "wfh_hours", credit: 0 });
    expect(r.wfhOnlyDays).toBe(2);
    expect(r.bankedDays + r.compensationDays).toBe(0);
    expect(r.payableDays).toBe(month(10, partTimer([...base, ...office])).payableDays);
    expectConsistent(r);
  });

  test("WFH days don't fill the office quota: 2 office + 2 WFH is one day short", () => {
    const r = month(10, partTimer([...base, "2026-10-05", "2026-10-06"], {}, [], { wfh: ["2026-10-07", "2026-10-08"] }));
    expect(r.absentDays).toBe(1);
  });

  test("half days beyond the quota are not paid; the week pays exactly its quota", () => {
    const r = month(10, partTimer([...base, ...office], {}, [], { half: ["2026-10-08"] }));
    expect(at(r, "2026-10-08")).toMatchObject({ status: "half_day", note: "over_quota", credit: 0 });
    expect(r.overQuotaHalfDays).toBe(1);
    expect(r.payableDays).toBe(month(10, partTimer([...base, ...office])).payableDays);
    expectConsistent(r);
  });

  test("two half days over the quota make one whole extra day (banked)", () => {
    const r = month(10, partTimer([...metHistory(), ...base, ...office], {}, [], { half: ["2026-10-08", "2026-10-09"] }));
    expect(r.bankedDays).toBe(1);
    expect(r.overQuotaHalfDays).toBe(0);
    expect(r.payableDays).toBe(month(10, partTimer([...base, ...office])).payableDays);
    expectConsistent(r);
  });

  test("a short week in September (old counting) is made up by an October extra day", () => {
    // Week of 14 Sep: 2 of 3. Every other Aug/Sep week: 3 (Mon-Wed). October week of 5 Oct: 4.
    const l = partTimer([...metHistory().filter((d) => d !== "2026-09-16"), ...base, ...office, "2026-10-08"]);
    const sep = month(9, l);
    const oct = month(10, l);
    expect(sep.madeUp).toEqual([{ missed: expect.objectContaining({ kind: "shortfall", weekStart: "2026-09-14" }), on: "2026-10-08" }]);
    expect(at(oct, "2026-10-08")).toMatchObject({ status: "compensation", credit: 1, madeUpFor: { weekStart: "2026-09-14" } });
    expectConsistent(oct);
  });
});

describe("randomised: every extra day is paid exactly once (300 histories)", () => {
  // A seeded PRNG so a failure is reproducible.
  let seed = 20261101;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

  for (let run = 0; run < 300; run++) {
    const flexible = run % 2 === 1;
    const days: string[] = [];
    for (let t = Date.UTC(2026, 7, 1); t <= Date.UTC(2026, 9, 31); t += 86_400_000) {
      const d = new Date(t);
      const p = flexible ? 0.45 : d.getUTCDay() === 0 ? 0.25 : 0.88;
      if (rand() < p) days.push(key(d));
    }
    // Some histories get holidays, including a whole holiday week.
    const holidays = run % 3 === 0 ? ["2026-10-02", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"] : [];
    const lookups = flexible
      ? partTimer(days, {}, holidays)
      : { ...fullTimer({}), attendanceByDate: new Map(days.map((d) => [d, full()] as const)) };

    test(`${flexible ? "part-time" : "full-time"} #${run}`, () => {
      const ledger = buildExtraDayLedger(lookups as Parameters<typeof classifyMonth>[2], NOW);
      let compensation = 0;
      let banked = 0;
      let madeUpOnDays = 0;
      for (const m of [8, 9, 10]) {
        const r = month(m, lookups);
        expectConsistent(r);
        compensation += r.days.filter((d) => d.date >= "2026-10-01" && d.status === "compensation").length;
        banked += r.bankedDays;
        madeUpOnDays += r.madeUp.length;
      }
      // Each extra day under the rule did exactly one thing...
      expect(compensation + banked).toBe(ledger.verdicts.size);
      // ...each make-up pairs one extra day with one missed day, never twice. Pre-rule
      // extra days settle pre-rule missed days only, and pay nothing.
      const made = [...ledger.madeUpOn.entries()];
      expect(made.filter(([, on]) => on >= "2026-10-01").length).toBe(compensation);
      expect(new Set(made.map(([, on]) => on)).size).toBe(made.length);
      expect(made.filter(([, on]) => on < "2026-10-01").every(([id]) => id.slice(0, 10) < "2026-10-01")).toBe(true);
      // Every made-up missed day shows its note in its own month (Aug-Oct walked).
      expect(madeUpOnDays).toBe(made.length);
    });
  }
});

describe("before the rule, a month that balanced itself stays balanced (owner, 2026-11-01)", () => {
  // A part-timer (3 days/week) misses the whole week of 7 Sep (3 days short), then in
  // the week of 21 Sep works 6 days — 3 extra, paid as days under the old rule. Week of
  // 28 Sep: exactly 3. Week of 5 Oct: 4 — one extra day, 8 Oct.
  const base = [
    ...metHistory().filter((d) => !(d >= "2026-09-07" && d <= "2026-09-13")),
    "2026-09-28", "2026-09-29", "2026-09-30",
    "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08",
  ];
  const coveredInSeptember = ["2026-09-24", "2026-09-25", "2026-09-26"];

  test("September covered its own missed week, so October's extra day is banked, not paid again", () => {
    const l = partTimer([...base, ...coveredInSeptember]);
    const oct = month(10, l);
    expect(at(oct, "2026-10-08")).toMatchObject({ status: "present", banked: true, credit: 0 });
    expect(oct.compensationDays).toBe(0);
    // September shows its missed week settled by its own extra days.
    const sep = month(9, l);
    expect(sep.madeUp.map((m) => m.on).sort()).toEqual(coveredInSeptember);
    expectConsistent(oct);
  });

  test("without those September extra days the missed week is still owed, and 8 Oct makes one day of it up", () => {
    const oct = month(10, partTimer(base));
    expect(at(oct, "2026-10-08")).toMatchObject({
      status: "compensation",
      credit: 1,
      madeUpFor: { kind: "shortfall", weekStart: "2026-09-07" },
    });
  });
});

describe("groupMadeUp / madeUpSentence — one line per missed thing", () => {
  test("three days short in one week, made up on three days, read as one line", () => {
    const groups = groupMadeUp([
      { on: "2026-10-18", missedDate: "2026-09-13", missedKind: "shortfall", weekStart: "2026-09-07" },
      { on: "2026-10-04", missedDate: "2026-09-13", missedKind: "shortfall", weekStart: "2026-09-07" },
      { on: "2026-10-25", missedDate: "2026-09-13", missedKind: "shortfall", weekStart: "2026-09-07" },
      { on: "2026-10-24", missedDate: "2026-10-07", missedKind: "unpaid_leave" },
    ]);
    expect(groups.map(madeUpSentence)).toEqual([
      "4, 18 and 25 Oct made up 3 days short in the week of 7 Sep",
      "24 Oct made up the unpaid day of 7 Oct",
    ]);
  });

  test("a single make-up and days across two months", () => {
    expect(
      madeUpSentence({ ons: ["2026-09-30", "2026-10-04"], missedDate: "2026-09-27", missedKind: "shortfall", weekStart: "2026-09-21" }),
    ).toBe("30 Sep and 4 Oct made up 2 days short in the week of 21 Sep");
    expect(madeUpSentence({ ons: ["2026-10-04"], missedDate: "2026-09-15", missedKind: "absence" })).toBe(
      "4 Oct made up the absence of 15 Sep",
    );
  });
});
