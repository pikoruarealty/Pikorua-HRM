// Extra days, compensation and balance days (2026-11-01, owner rule — replaces the
// "an advance day is paid AND banks a credit" arithmetic of 2026-10-24, which paid
// one extra day twice once the credit was used).
//
// An EXTRA day is a day worked beyond what the employee owed: a worked weekly off
// (fixed schedule), a day flagged as compensation by Admin/HR, or a part-timer's day
// beyond their weekly quota. An extra day is never paid as an extra day. It does one
// of two things, decided once, in date order:
//
//  1. COMPENSATION — the employee has an earlier missed day that nothing has covered
//     yet (an absent day, a whole unpaid-leave day, or one day of a part-timer's
//     weekly-quota shortfall), at most 60 days back, in this month or an earlier
//     one. The extra day makes that day up: it is shown as "Compensation · for <day>"
//     and is paid (+1) in the month it was WORKED — the missed day's own month may
//     already have been paid without it. The missed day keeps its status (absent /
//     unpaid, 0) and reads "made up on <day>". Oldest missed day first; absences and
//     quota shortfalls before unpaid-leave days.
//  2. BANKED (advance) — nothing to make up. Shown as Present ("worked in advance"),
//     worth 0 now, and banked as a balance day for 60 days. The employee may ask to
//     use it on a later absent / unpaid-leave day (a `balance_day` request, approved
//     by Admin/HR); that day then counts as paid ("Balance · earned <day>"). A balance
//     day nobody used tops up the leave balance once it expires.
//
// Either way the extra day is paid exactly once, in the month the make-up happens.
//
// Where the work happened (2026-10-24 owner rule) still applies to both: a missed
// in-office day can only be made up by an office day; a missed WFH day by either.
//
// The rule starts on EXTRA_DAY_RULE_FROM. Extra days before it keep the treatment
// they were paid under (a full day each) and take no part in matching; missed days
// up to 60 days before it CAN be made up by an extra day after it (the "last month's
// absence made up this month" case).
//
// Everything here is pure: the attendance walk (monthly-breakdown.ts) lists the
// missed units and extra days, this file pairs them, and the walk then labels and
// pays each day from the result — so the calendar, the tiles, the PDF and the
// balance card all read one decision.

export const EXTRA_DAY_RULE_FROM = "2026-10-01";
export const BALANCE_WINDOW_DAYS = 60;

export type Place = "office" | "wfh";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The one location rule: may a day earned at `earned` cover a day owed at `owed`?
 *  Office covers anything; WFH covers only a WFH day. */
export function canCreditCover(earned: Place, owed: Place): boolean {
  return earned === "office" || owed === "wfh";
}

export function addDaysKey(key: string, days: number): string {
  return new Date(Date.parse(`${key}T00:00:00.000Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T00:00:00.000Z`) - Date.parse(`${fromKey}T00:00:00.000Z`)) / MS_PER_DAY);
}

/** Where a day was worked, for what it can make up: an office day if any of it was in
 *  the office, WFH if it was all from home, else the record's own location. */
export function dayPlace(
  totalHours: number | null,
  sessions: { clockIn: Date; clockOut: Date | null; workLocation: string }[],
  fallback: string,
): Place {
  if (totalHours != null && totalHours > 0) {
    let office = 0;
    let wfh = 0;
    for (const s of sessions) {
      if (!s.clockOut) continue;
      const ms = Math.max(0, s.clockOut.getTime() - s.clockIn.getTime());
      if (s.workLocation === "wfh") wfh += ms;
      else office += ms;
    }
    if (office > 0) return "office";
    if (wfh > 0) return "wfh";
  }
  return fallback === "wfh" ? "wfh" : "office";
}

/** A day owed and not covered: a whole absent day, a whole unpaid-leave day, or one
 *  whole day of a part-timer's weekly-quota shortfall (no single date — it is dated
 *  the last day of its week, `weekStart` says which week). `id` is unique per unit. */
export type MissedUnit = {
  id: string;
  date: string;
  kind: "absence" | "unpaid_leave" | "shortfall";
  location: Place;
  weekStart?: string;
};

export type ExtraDay = {
  date: string;
  location: Place;
  /** Worked before the rule date: it was already paid as a day, so it only settles
   *  missed days of that same (pre-rule) period — see matchExtraDays. */
  legacy?: boolean;
};

export type BankedDay = {
  /** The day worked in advance. */
  date: string;
  location: Place;
  /** Last day it can be used on (earned + 60 days). */
  expires: string;
  /** available: can still be used; used: spent on `usedFor` (an approved request);
   *  expired: lapsed unused (it tops up the leave balance instead). */
  status: "available" | "used" | "expired";
  usedFor?: string;
};

export type ExtraVerdict =
  | { kind: "compensation"; missed: MissedUnit }
  | ({ kind: "banked" } & BankedDay);

export type ExtraDayLedger = {
  /** Extra day date -> what it did. */
  verdicts: Map<string, ExtraVerdict>;
  /** Missed unit id -> the extra day that made it up. */
  madeUpOn: Map<string, string>;
  /** Every banked day, oldest first. */
  bank: BankedDay[];
};

/**
 * Pairs extra days with earlier missed days. Pure.
 *
 * `usedBalance` maps an extra day to the day it was spent on through an approved
 * balance-day request: such an extra day is banked by definition (the request was
 * approved against it) and is never re-used as compensation, so an approval can't be
 * undone by a later recalculation. The day it covered is a paid day in the walk, so
 * it is not in `missed` at all.
 */
export function matchExtraDays(input: {
  missed: MissedUnit[];
  extras: ExtraDay[];
  usedBalance?: Map<string, string>;
  todayKey: string;
  /** Defaults to EXTRA_DAY_RULE_FROM. */
  ruleFrom?: string;
}): ExtraDayLedger {
  const ruleFrom = input.ruleFrom ?? EXTRA_DAY_RULE_FROM;
  const used = input.usedBalance ?? new Map<string, string>();
  const order = (k: MissedUnit["kind"]) => (k === "unpaid_leave" ? 1 : 0);
  const missed = [...input.missed].sort((a, b) =>
    order(a.kind) !== order(b.kind) ? order(a.kind) - order(b.kind) : a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
  const extras = [...input.extras].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const verdicts = new Map<string, ExtraVerdict>();
  const madeUpOn = new Map<string, string>();
  const bank: BankedDay[] = [];

  // Before the rule an extra day was paid as a day, and the missed days around it were
  // deducted — so that period already balances (owner, 2026-11-01: "I didn't come
  // for 10-12 days, then covered for it in the rest of the month — that was already
  // compensated"). Each pre-rule extra day therefore settles one pre-rule missed day —
  // an earlier one first, else a later one in the same period — so those missed days
  // are not made up a second time by extra days after the rule. It changes no pay
  // and banks nothing. It never touches a missed day on/after the rule date.
  for (const extra of extras) {
    if (!extra.legacy) continue;
    const inReach = (m: MissedUnit) =>
      !madeUpOn.has(m.id) && m.date < ruleFrom && Math.abs(daysBetween(m.date, extra.date)) <= BALANCE_WINDOW_DAYS;
    const match =
      missed.find((m) => inReach(m) && m.date < extra.date) ?? missed.find((m) => inReach(m) && m.date > extra.date);
    if (match) madeUpOn.set(match.id, extra.date);
  }

  for (const extra of extras) {
    if (extra.legacy || verdicts.has(extra.date)) continue;
    const usedFor = used.get(extra.date);
    const match = usedFor
      ? undefined
      : missed.find(
          (m) =>
            !madeUpOn.has(m.id) &&
            m.date < extra.date &&
            daysBetween(m.date, extra.date) <= BALANCE_WINDOW_DAYS &&
            canCreditCover(extra.location, m.location),
        );
    if (match) {
      madeUpOn.set(match.id, extra.date);
      verdicts.set(extra.date, { kind: "compensation", missed: match });
      continue;
    }
    const expires = addDaysKey(extra.date, BALANCE_WINDOW_DAYS);
    const banked: BankedDay = {
      date: extra.date,
      location: extra.location,
      expires,
      status: usedFor ? "used" : expires < input.todayKey ? "expired" : "available",
      ...(usedFor ? { usedFor } : {}),
    };
    bank.push(banked);
    verdicts.set(extra.date, { kind: "banked", ...banked });
  }

  return { verdicts, madeUpOn, bank };
}

/** The banked day a request would spend on `day` (owed at `place`): an available one
 *  earned on or before it, still inside its 60 days, that may cover it — the one
 *  expiring soonest, so none lapses while a later one is spent. */
export function pickBankedDay(bank: BankedDay[], day: string, place: Place): BankedDay | null {
  const eligible = bank
    .filter((b) => b.status === "available" && b.date <= day && day <= b.expires && canCreditCover(b.location, place))
    .sort((a, b) => (a.expires < b.expires ? -1 : a.expires > b.expires ? 1 : 0));
  // A WFH day takes a WFH-earned day first, keeping the more flexible office one.
  if (place === "wfh") return eligible.find((b) => b.location === "wfh") ?? eligible[0] ?? null;
  return eligible[0] ?? null;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (key: string) => `${Number(key.slice(8, 10))} ${MON[Number(key.slice(5, 7)) - 1]}`;

/** One missed thing and every extra day that made it up. A part-timer's short week
 *  can be several days short, each made up by a different extra day — listed one by
 *  one, "a day short in the week of 7 Sep" three times read like one day paid three
 *  times, so they are grouped into one line. */
export type MadeUpGroup = {
  /** The extra days that did the making up, in date order. */
  ons: string[];
  missedDate: string;
  missedKind: MissedUnit["kind"];
  weekStart?: string;
};

export function groupMadeUp(
  entries: { on: string; missedDate: string; missedKind: MissedUnit["kind"]; weekStart?: string }[],
): MadeUpGroup[] {
  const groups = new Map<string, MadeUpGroup>();
  for (const e of entries) {
    const k = e.missedKind === "shortfall" && e.weekStart ? `w|${e.weekStart}` : `${e.missedKind}|${e.missedDate}|${e.on}`;
    const g = groups.get(k);
    if (g) g.ons.push(e.on);
    else groups.set(k, { ons: [e.on], missedDate: e.missedDate, missedKind: e.missedKind, ...(e.weekStart ? { weekStart: e.weekStart } : {}) });
  }
  return [...groups.values()]
    .map((g) => ({ ...g, ons: [...g.ons].sort() }))
    .sort((a, b) => (a.ons[0]! < b.ons[0]! ? -1 : 1));
}

/** "4, 18 and 25 Oct" (the month once when they share it). */
function dayList(keys: string[]): string {
  const sameMonth = keys.every((k) => k.slice(0, 7) === keys[0]!.slice(0, 7));
  const parts = keys.map((k, i) => (sameMonth && i < keys.length - 1 ? String(Number(k.slice(8, 10))) : short(k)));
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** "4, 18 and 25 Oct made up 3 days short in the week of 7 Sep" / "24 Oct made up the
 *  unpaid day of 7 Oct". */
export function madeUpSentence(g: MadeUpGroup): string {
  const missed =
    g.missedKind === "shortfall" && g.weekStart
      ? g.ons.length === 1
        ? `a day short in the week of ${short(g.weekStart)}`
        : `${g.ons.length} days short in the week of ${short(g.weekStart)}`
      : `the ${g.missedKind === "unpaid_leave" ? "unpaid day" : "absence"} of ${short(g.missedDate)}`;
  return `${dayList(g.ons)} made up ${missed}`;
}
