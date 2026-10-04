// "Events this week" date math (2026-10-04) — pure and client-safe so the
// dashboard card, its API route and the tests all agree on what "this week" is.
//
// Everything is the IST calendar (the office's clock), never the server's: a UTC
// "today" is already IST-tomorrow after 18:30, and a 9am IST meeting is the
// *previous* UTC day. A week is Monday–Sunday, like the attendance weeks.

export const IST_TIMEZONE = "Asia/Kolkata";
const IST_OFFSET = "+05:30"; // India has no DST, so a fixed offset is exact.
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD of an instant on the IST calendar. */
export function istDateKey(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: IST_TIMEZONE });
}

function keyToUtcMidnight(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

function utcMidnightToKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The Monday–Sunday week (as seven YYYY-MM-DD keys) containing `now` in IST. */
export function istWeekKeys(now: Date): string[] {
  const today = keyToUtcMidnight(istDateKey(now));
  const sinceMonday = (today.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  const monday = today.getTime() - sinceMonday * MS_PER_DAY;
  return Array.from({ length: 7 }, (_, i) => utcMidnightToKey(new Date(monday + i * MS_PER_DAY)));
}

/** The instants [start, end) covering the IST week that starts on `mondayKey`. */
export function istWeekRange(mondayKey: string): { start: Date; end: Date } {
  const start = new Date(`${mondayKey}T00:00:00${IST_OFFSET}`);
  return { start, end: new Date(start.getTime() + 7 * MS_PER_DAY) };
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** "MM-DD" of a stored date-only value (UTC midnight, like every @db.Date). */
export function monthDayOf(d: Date): string {
  return d.toISOString().slice(5, 10);
}

/** Does an annually recurring date (birthday, anniversary, custom event) fall on
 *  `dateKey`? A 29 Feb date is observed on 28 Feb in a non-leap year rather than
 *  silently skipped. */
export function recursOn(monthDay: string, dateKey: string): boolean {
  const year = Number(dateKey.slice(0, 4));
  const observed = monthDay === "02-29" && !isLeapYear(year) ? "02-28" : monthDay;
  return dateKey.slice(5) === observed;
}

export type WeekEventKind = "meeting" | "holiday" | "birthday" | "anniversary" | "custom";

export type WeekEventItem = {
  id: string;
  kind: WeekEventKind;
  /** YYYY-MM-DD on the IST calendar. */
  date: string;
  title: string;
  subtitle?: string;
  /** Meetings only: the full instant, so the client shows it in IST. */
  at?: string;
};

const KIND_ORDER: Record<WeekEventKind, number> = { holiday: 0, meeting: 1, birthday: 2, anniversary: 3, custom: 4 };

/** Date, then meetings by time of day, then a stable kind order. */
export function sortWeekEvents(items: WeekEventItem[]): WeekEventItem[] {
  return [...items].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      (a.at ?? "").localeCompare(b.at ?? "") ||
      a.title.localeCompare(b.title),
  );
}
