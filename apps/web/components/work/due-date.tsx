import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format-date";

// Pillar 1 (2026-08-08). One place that decides how a WorkItem due date reads,
// so the Lead-side (work unit detail), the employee-side (My Tasks) and the
// planning screen can never disagree about what "overdue" means.
//
// Due dates are date-only (`@db.Date`), serialised as an ISO instant at UTC
// midnight. Comparing them needs the same UTC-day flattening the API uses —
// comparing against a local `new Date()` would mark a task due today as overdue
// for anyone east of UTC.

/** Today as a UTC-midnight timestamp, matching how due dates are stored. */
function utcTodayMs(now = new Date()): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** UTC-midnight timestamp of an ISO date/instant string, or null if unparseable. */
function utcDayMs(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export type DueState = "overdue" | "today" | "upcoming";

export function dueState(dueDate: string, now = new Date()): DueState | null {
  const due = utcDayMs(dueDate);
  if (due === null) return null;
  const today = utcTodayMs(now);
  if (due < today) return "overdue";
  if (due === today) return "today";
  return "upcoming";
}

/**
 * Compact "Due 12/08/2026" pill. `completed` mutes it — a finished task's due
 * date is history, not a warning, so it never shows red after the fact.
 */
export function DueDateBadge({
  dueDate,
  completed = false,
}: {
  dueDate?: string | null;
  completed?: boolean;
}) {
  if (!dueDate) return null;
  const state = completed ? null : dueState(dueDate);
  const variant = state === "overdue" ? "destructive" : state === "today" ? "warning" : "muted";
  const label = state === "overdue" ? "Overdue" : state === "today" ? "Due today" : "Due";
  return (
    <Badge variant={variant} title={`Due ${formatDate(dueDate)}`}>
      {label} · {formatDate(dueDate)}
    </Badge>
  );
}
