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
//  2. BANKED (advance) — nothing to make up yet. Shown as Present ("worked in
//     advance"), worth 0 now, banked as a balance day for 60 days. The next missed
//     day after it — a plain absence, or a part-timer's short-week day; never a day
//     that already carries leave — is COVERED by it automatically (owner, 2026-11-01:
//     "yes automatically, if the weekly off is already claimed for that week and no
//     leave is marked on that day"; a full-timer's no-show is only "absent" once the
//     week's off is used elsewhere, so that holds by construction). The covered day is
//     paid in its own month, shown "Balance · earned <day>". A balance-day request can
//     still put one on a specific day. One nobody used tops up the leave balance.
//
// Either way the extra day is paid exactly once, in the month the pairing happens.
// Weeks are Monday to Sunday everywhere (quota, weekly off, WFH cap); a part-timer's
// extra days are the ones worked after the week's quota was already met.
//
// Where the work happened (2026-10-24 owner rule) still applies: a missed in-office
// day can only be made up / covered by an office day; a missed WFH day by either.
//
// The rule starts on EXTRA_DAY_RULE_FROM. Extra days before it keep the treatment
// they were paid under (a full day each) and only settle missed days of that period
// (it balanced itself); missed days up to 60 days before the rule that nothing settled
// CAN be made up by an extra day after it ("last month's absence made up this month") —
// but only from MAKE_UP_FROM (1 Sep 2026) on: HRM wasn't properly enforced before, so an
// older "absence" is never made up.
//
// Everything here is pure: the attendance walk (monthly-breakdown.ts) lists the
// missed units and extra days, this file pairs them, and the walk then labels and
// pays each day from the result — so the calendar, the tiles, the PDF and the
// balance card all read one decision.

export const EXTRA_DAY_RULE_FROM = "2026-10-01";
export const BALANCE_WINDOW_DAYS = 60;
/** Missed days before this date are never made up by a later extra day (owner,
 *  2026-11-02): HRM was only properly enforced from September, so an earlier "absence"
 *  may be untracked rather than real — it must not turn an October extra day into pay.
 *  The 60-day window alone reached 5 Aug from 4 Oct. */
export const MAKE_UP_FROM = "2026-09-01";

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
  /** How much of a day: 1 (default) or 0.5 — a part-timer's month can be half a day short. */
  size?: number;
  weekStart?: string;
  /** A part-timer's monthly shortfall (from the rule on): the month, "YYYY-MM". */
  month?: string;
  /** For a shortfall day: the not-worked day of that week (in the month that owns the
   *  week) that a banked day would be put on if it covers this unit automatically —
   *  so the pay lands on a real calendar day. None when the week has no such day. */
  coverDate?: string;
};

export type ExtraDay = {
  date: string;
  location: Place;
  /** How much of the day is extra: 1 (default) or 0.5 (a part-timer's month over by
   *  half a day, or a half day worked beyond the month's quota). */
  size?: number;
  /** Worked before the rule date: it was already paid as a day, so it only settles
   *  missed days of that same (pre-rule) period — see matchExtraDays. */
  legacy?: boolean;
};

export type BankedDay = {
  /** The day worked in advance. */
  date: string;
  location: Place;
  /** How much of a day this is: 1 or 0.5 (owner, 2026-11-01: half days bank too, two
   *  halves make a day). One worked day can show as two entries when half of it was
   *  used and half is still available. */
  amount: number;
  /** Last day it can be used on (earned + 60 days). */
  expires: string;
  /** available: can still be used; used: spent on `usedFor` (automatically on a later
   *  missed day, or through an approved request); expired: lapsed unused (it tops up
   *  the leave balance instead). */
  status: "available" | "used" | "expired";
  usedFor?: string;
  /** Spent automatically by the ledger (not through a request). */
  auto?: boolean;
};

/** What an extra day did. Most extra days do one thing; a day can be split when it is
 *  worth more than what was left to make up (a whole day making up half a missed day
 *  banks the other half), so `banked` also carries how much of it made something up. */
export type ExtraVerdict =
  | { kind: "compensation"; missed: MissedUnit; amount: number }
  | ({ kind: "banked"; compensated: number; missed?: MissedUnit } & BankedDay);

export type ExtraDayLedger = {
  /** Extra day date -> what it did. */
  verdicts: Map<string, ExtraVerdict>;
  /** Missed unit id -> the LATER extra day that made it up (compensation), or the
   *  pre-rule extra day that settled it (the first one, when two halves did). */
  madeUpOn: Map<string, string>;
  /** Missed unit id -> how much of it was made up / settled (its size when whole). */
  madeUpAmount: Map<string, number>;
  /** Missed unit id -> the EARLIER banked day that covered it automatically, the
   *  calendar day the cover is put on (the missed day itself, or for a shortfall the
   *  chosen not-worked day) and how much it covered. That day is paid in its own month. */
  coveredBy: Map<string, { by: string; date: string; amount: number }>;
  /** Every banked day, oldest first (a day half used / half available is two entries). */
  bank: BankedDay[];
};

const byDate = <T extends { date: string }>(a: T, b: T) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/** Half-day pieces: the matcher works in halves so half days bank, cover and make up
 *  like whole ones (two halves make a day). A whole unit is two pieces, matched in
 *  order, so whole days pair exactly as they did before halves existed. */
const pieces = (size: number | undefined) => Math.max(1, Math.round((size ?? 1) * 2));

/**
 * Nets extra days against missed days. Pure. In date order (2026-11-01 rule):
 *  - a missed day with a banked day before it (within its 60 days, office/WFH rule) is
 *    covered by that banked day automatically — an absence or a short-month day only;
 *    a day that already carries leave is left as the leave says (owner);
 *  - an extra day with an uncovered missed day before it (within 60 days) makes it up
 *    (compensation) — absences and short days first, then unpaid-leave days;
 *  - an extra day with nothing to make up is banked.
 * So every extra day is paid once, in the month the pairing happens, whichever came
 * first. Pre-rule extra days (already paid as days) only settle pre-rule missed days.
 * All of it in half-day pieces (see `pieces`).
 *
 * `usedBalance` maps an extra day to the day it was spent on through an approved
 * balance-day request: it stays spent on that day (an approval is never undone by a
 * recalculation), and that day is a paid day in the walk, so not in `missed`.
 */
export function matchExtraDays(input: {
  missed: MissedUnit[];
  extras: ExtraDay[];
  usedBalance?: Map<string, string>;
  todayKey: string;
  /** Defaults to EXTRA_DAY_RULE_FROM. */
  ruleFrom?: string;
  /** Earliest missed day an extra day may make up. Defaults to MAKE_UP_FROM. */
  makeUpFrom?: string;
}): ExtraDayLedger {
  const ruleFrom = input.ruleFrom ?? EXTRA_DAY_RULE_FROM;
  const makeUpFrom = input.makeUpFrom ?? MAKE_UP_FROM;
  const used = input.usedBalance ?? new Map<string, string>();
  const order = (k: MissedUnit["kind"]) => (k === "unpaid_leave" ? 1 : 0);

  type MissedPiece = { unit: MissedUnit; settledBy?: string; coveredBy?: { by: string; date: string } };
  type BankPiece = {
    date: string;
    location: Place;
    expires: string;
    status: BankedDay["status"];
    usedFor?: string;
    auto?: boolean;
  };
  const missedPieces: MissedPiece[] = [];
  for (const m of input.missed) for (let k = 0; k < pieces(m.size); k++) missedPieces.push({ unit: m });
  // The pool an extra day makes up from: oldest first, absences before unpaid days.
  const pool = [...missedPieces].sort((a, b) =>
    order(a.unit.kind) !== order(b.unit.kind) ? order(a.unit.kind) - order(b.unit.kind) : byDate(a.unit, b.unit),
  );
  const extras = [...input.extras].sort(byDate);
  const settled = (p: MissedPiece) => !!p.settledBy || !!p.coveredBy;

  // Before the rule an extra day was paid as a day, and the missed days around it were
  // deducted — so that period already balances (owner, 2026-11-01: "I didn't come
  // for 10-12 days, then covered for it in the rest of the month — that was already
  // compensated"). Each pre-rule extra day therefore settles pre-rule missed days —
  // an earlier one first, else a later one in the same period — so those missed days
  // are not made up a second time by extra days after the rule. It changes no pay
  // and banks nothing. It never touches a missed day on/after the rule date.
  for (const extra of extras) {
    if (!extra.legacy) continue;
    for (let k = 0; k < pieces(extra.size); k++) {
      const inReach = (p: MissedPiece) =>
        !p.settledBy && p.unit.date < ruleFrom && Math.abs(daysBetween(p.unit.date, extra.date)) <= BALANCE_WINDOW_DAYS;
      const match =
        pool.find((p) => inReach(p) && p.unit.date < extra.date) ?? pool.find((p) => inReach(p) && p.unit.date > extra.date);
      if (match) match.settledBy = extra.date;
    }
  }

  // One timeline: missed pieces and (post-rule) extra pieces in date order. A missed
  // day dated the same day as an extra day is handled first.
  type Event = { date: string; missed?: MissedPiece; extra?: ExtraDay };
  const events: Event[] = [
    ...missedPieces.map((m): Event => ({ date: m.unit.date, missed: m })),
    ...extras
      .filter((e) => !e.legacy)
      .flatMap((e) => Array.from({ length: pieces(e.size) }, (): Event => ({ date: e.date, extra: e }))),
  ];
  events.sort((a, b) => byDate(a, b) || (a.missed ? -1 : 1) - (b.missed ? -1 : 1));

  const bank: BankPiece[] = [];
  const compensated = new Map<string, { amount: number; missed: MissedUnit }>();
  const seenExtra = new Map<string, number>();
  const requestPieces = new Map<string, number>();

  for (const ev of events) {
    if (ev.missed) {
      const m = ev.missed;
      if (settled(m)) continue;
      // Automatic cover only for a plain absence / short day, on a real day.
      const u = m.unit;
      const coverDate = u.kind === "absence" ? u.date : u.kind === "shortfall" ? u.coverDate : undefined;
      if (!coverDate) continue;
      const b = bank
        .filter(
          (x) => x.status === "available" && x.date < u.date && u.date <= x.expires && canCreditCover(x.location, u.location),
        )
        .sort((x, y) => (x.expires < y.expires ? -1 : x.expires > y.expires ? 1 : 0))[0];
      if (b) {
        b.status = "used";
        b.usedFor = coverDate;
        b.auto = true;
        m.coveredBy = { by: b.date, date: coverDate };
      }
      continue;
    }

    const extra = ev.extra!;
    const n = seenExtra.get(extra.date) ?? 0;
    if (n >= pieces(extra.size)) continue; // a date listed twice: count it once
    seenExtra.set(extra.date, n + 1);
    // A balance-day request spends one whole day of it (two halves).
    const usedFor = used.get(extra.date);
    const requestSpent = !!usedFor && (requestPieces.get(extra.date) ?? 0) < 2;
    const match = requestSpent
      ? undefined
      : pool.find(
          (p) =>
            !settled(p) &&
            p.unit.date >= makeUpFrom &&
            p.unit.date < extra.date &&
            daysBetween(p.unit.date, extra.date) <= BALANCE_WINDOW_DAYS &&
            canCreditCover(extra.location, p.unit.location),
        );
    if (match) {
      match.settledBy = extra.date;
      const c = compensated.get(extra.date);
      if (c) c.amount += 0.5;
      else compensated.set(extra.date, { amount: 0.5, missed: match.unit });
      continue;
    }
    if (requestSpent) requestPieces.set(extra.date, (requestPieces.get(extra.date) ?? 0) + 1);
    bank.push({
      date: extra.date,
      location: extra.location,
      expires: addDaysKey(extra.date, BALANCE_WINDOW_DAYS),
      status: requestSpent ? "used" : "available",
      ...(requestSpent ? { usedFor } : {}),
    });
  }

  // What is left unspent lapses after its 60 days.
  for (const b of bank) if (b.status === "available" && b.expires < input.todayKey) b.status = "expired";

  // Pieces -> entries: one per day and status (and the day it was used on).
  const grouped = new Map<string, BankedDay>();
  for (const b of bank) {
    const k = `${b.date}|${b.status}|${b.usedFor ?? ""}`;
    const g = grouped.get(k);
    if (g) g.amount += 0.5;
    else
      grouped.set(k, {
        date: b.date,
        location: b.location,
        amount: 0.5,
        expires: b.expires,
        status: b.status,
        ...(b.usedFor ? { usedFor: b.usedFor } : {}),
        ...(b.auto ? { auto: true } : {}),
      });
  }
  const bankDays = [...grouped.values()].sort(byDate);

  const verdicts = new Map<string, ExtraVerdict>();
  for (const [date, c] of compensated) verdicts.set(date, { kind: "compensation", missed: c.missed, amount: c.amount });
  const rank = { available: 0, used: 1, expired: 2 } as const;
  for (const date of new Set(bankDays.map((b) => b.date))) {
    const mine = bankDays.filter((b) => b.date === date).sort((a, b) => rank[a.status] - rank[b.status]);
    const usedOne = mine.find((b) => b.usedFor);
    const c = compensated.get(date);
    verdicts.set(date, {
      kind: "banked",
      ...mine[0]!,
      amount: mine.reduce((a, b) => a + b.amount, 0),
      ...(usedOne?.usedFor ? { usedFor: usedOne.usedFor } : {}),
      compensated: c?.amount ?? 0,
      ...(c ? { missed: c.missed } : {}),
    });
  }

  const madeUpOn = new Map<string, string>();
  const madeUpAmount = new Map<string, number>();
  const coveredBy = new Map<string, { by: string; date: string; amount: number }>();
  for (const p of missedPieces) {
    const id = p.unit.id;
    if (p.settledBy) {
      if (!madeUpOn.has(id)) madeUpOn.set(id, p.settledBy);
      madeUpAmount.set(id, (madeUpAmount.get(id) ?? 0) + 0.5);
    } else if (p.coveredBy) {
      const c = coveredBy.get(id);
      if (c) c.amount += 0.5;
      else coveredBy.set(id, { ...p.coveredBy, amount: 0.5 });
    }
  }
  return { verdicts, madeUpOn, madeUpAmount, coveredBy, bank: bankDays };
}

/** The banked day a request would spend on `day` (owed at `place`): an available WHOLE
 *  one (a request covers a whole day; half days are only spent automatically) earned
 *  on or before it, still inside its 60 days, that may cover it — the one expiring
 *  soonest, so none lapses while a later one is spent. */
export function pickBankedDay(bank: BankedDay[], day: string, place: Place): BankedDay | null {
  const eligible = bank
    .filter(
      (b) =>
        b.status === "available" && b.amount >= 1 && b.date <= day && day <= b.expires && canCreditCover(b.location, place),
    )
    .sort((a, b) => (a.expires < b.expires ? -1 : a.expires > b.expires ? 1 : 0));
  // A WFH day takes a WFH-earned day first, keeping the more flexible office one.
  if (place === "wfh") return eligible.find((b) => b.location === "wfh") ?? eligible[0] ?? null;
  return eligible[0] ?? null;
}

/** Balance that can actually be used, in days: unspent, unexpired, earned in the
 *  office (a WFH-earned one only covers a WFH day, which can't be filed). */
export function usableBalance(bank: Pick<BankedDay, "status" | "location" | "amount">[]): number {
  return bank.filter((b) => b.status === "available" && b.location === "office").reduce((a, b) => a + b.amount, 0);
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const short = (key: string) => `${Number(key.slice(8, 10))} ${MON[Number(key.slice(5, 7)) - 1]}`;

/** "1", "0.5", "1.5" — half days are written as .5 everywhere (owner, 2026-11-01). */
export const dayAmount = (n: number) => String(Math.round(n * 2) / 2);

/** "0.5 day", "1 day", "1.5 days". */
export const dayAmountLabel = (n: number) => `${dayAmount(n)} day${n > 1 ? "s" : ""}`;

/** One missed thing and every extra day that made it up. A part-timer's short week or
 *  month can be several days short, each made up by a different extra day — listed one
 *  by one, "a day short in the week of 7 Sep" three times read like one day paid three
 *  times, so they are grouped into one line. */
export type MadeUpGroup = {
  /** The extra days that did the making up, in date order. */
  ons: string[];
  /** How much was made up, in days (default: a day per extra day). */
  amount?: number;
  missedDate: string;
  missedKind: MissedUnit["kind"];
  weekStart?: string;
  month?: string;
};

export function groupMadeUp(
  entries: {
    on: string;
    missedDate: string;
    missedKind: MissedUnit["kind"];
    weekStart?: string;
    month?: string;
    amount?: number;
  }[],
): MadeUpGroup[] {
  const groups = new Map<string, MadeUpGroup>();
  for (const e of entries) {
    const k =
      e.missedKind === "shortfall" && e.month
        ? `m|${e.month}`
        : e.missedKind === "shortfall" && e.weekStart
          ? `w|${e.weekStart}`
          : `${e.missedKind}|${e.missedDate}|${e.on}`;
    const g = groups.get(k);
    const amount = e.amount ?? 1;
    if (g) {
      if (!g.ons.includes(e.on)) g.ons.push(e.on);
      g.amount = (g.amount ?? 0) + amount;
    } else
      groups.set(k, {
        ons: [e.on],
        amount,
        missedDate: e.missedDate,
        missedKind: e.missedKind,
        ...(e.weekStart ? { weekStart: e.weekStart } : {}),
        ...(e.month ? { month: e.month } : {}),
      });
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

/** "4, 18 and 25 Oct made up 3 days short in the week of 7 Sep" / "2 Nov made up 1.5
 *  days short in October" / "24 Oct made up the unpaid day of 7 Oct". */
export function madeUpSentence(g: MadeUpGroup): string {
  const amount = g.amount ?? g.ons.length;
  const n = amount === 1 ? "a day" : dayAmountLabel(amount);
  const missed =
    g.missedKind === "shortfall" && g.month
      ? `${n} short in ${MONTH_NAMES[Number(g.month.slice(5, 7)) - 1]}`
      : g.missedKind === "shortfall" && g.weekStart
        ? `${n} short in the week of ${short(g.weekStart)}`
        : `${amount < 1 ? `${dayAmountLabel(amount)} of ` : ""}the ${g.missedKind === "unpaid_leave" ? "unpaid day" : "absence"} of ${short(g.missedDate)}`;
  return `${dayList(g.ons)} made up ${missed}`;
}

