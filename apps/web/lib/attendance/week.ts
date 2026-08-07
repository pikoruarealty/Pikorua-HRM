// Track A. Week-math + off-day resolution shared by the payroll attendance
// classification (lib/attendance/monthly-breakdown.ts) and the self-service
// weekly-off endpoints (owner request, 2026-08-08) — a "week" is Monday to
// Sunday, matched in server-local/UTC-midnight dates the same way
// todayDateOnly() does elsewhere in this module.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Monday (UTC midnight) of the ISO week containing `date`. */
export function weekStartOf(date: Date): Date {
  const day = date.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + diffToMonday));
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/** Builds a weekKey -> off-date-key map from a set of active WeeklyOffMove
 *  rows, so classification code can do a cheap per-day lookup instead of a
 *  query per day. */
export function buildMovedOffDateByWeek(moves: { weekStart: Date; date: Date }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of moves) {
    map.set(dateKey(m.weekStart), dateKey(m.date));
  }
  return map;
}

/** Resolves the effective default weekly-off day for an employee:
 *  Employee's custom default > Team's default > Sunday (0). */
export function resolveDefaultOffDay(
  employeeDefaultOffDay?: number | null,
  teamDefaultOffDay?: number | null,
): number {
  if (employeeDefaultOffDay != null) return employeeDefaultOffDay;
  if (teamDefaultOffDay != null) return teamDefaultOffDay;
  return 0;
}

/** True if `date` is the employee's off day for its week — either their
 *  active WeeklyOffMove for that week, or (absent a move) their effective
 *  default weekly-off day-of-week. */
export function isOffDay(
  date: Date,
  defaultOffDay: number,
  movedOffDateByWeek: Map<string, string>,
): boolean {
  const weekKey = dateKey(weekStartOf(date));
  const movedOffDate = movedOffDateByWeek.get(weekKey);
  if (movedOffDate) return movedOffDate === dateKey(date);
  return date.getUTCDay() === defaultOffDay;
}
