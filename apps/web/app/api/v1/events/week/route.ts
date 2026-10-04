import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { EmployeeStatus, EventType, type Prisma } from "@prisma/client";
import {
  istDateKey,
  istWeekKeys,
  istWeekRange,
  monthDayOf,
  recursOn,
  sortWeekEvents,
  type WeekEventItem,
} from "@/lib/events/week";

// GET /api/v1/events/week (2026-10-04) — the dashboard's "Events this week" card:
// everything dated inside the current Monday–Sunday week (IST), with its date.
// RBAC: any signed-in user, scoped the same way as the rest of the events API —
//   - holidays, birthdays, work anniversaries, custom milestones → everyone
//     (company-wide, celebratory; derived on read, recurring by month/day);
//   - meetings → Admin/HR all; everyone else only ones they created or are
//     invited to (directly or via their team), like GET /events/meetings.
// Leave is deliberately not an "event" here. Dates are IST calendar days (the
// /calendar feed buckets by UTC, which would put an early-morning IST meeting on
// the wrong day).

export async function GET() {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const now = new Date();
  const keys = istWeekKeys(now);
  const { start, end } = istWeekRange(keys[0]!);
  const items: WeekEventItem[] = [];

  // --- Holidays (@db.Date, UTC midnight) ------------------------------------
  const holidays = await prisma.holiday.findMany({
    where: { date: { gte: new Date(`${keys[0]}T00:00:00.000Z`), lte: new Date(`${keys[6]}T00:00:00.000Z`) } },
  });
  for (const h of holidays) {
    items.push({
      id: `holiday:${h.id}`,
      kind: "holiday",
      date: h.date.toISOString().slice(0, 10),
      title: h.name,
      subtitle: "Company holiday",
    });
  }

  // --- Birthdays & work anniversaries (derived, recur annually) -------------
  const employees = await prisma.employee.findMany({
    where: { status: EmployeeStatus.active },
    select: { id: true, fullName: true, dateOfBirth: true, dateOfJoining: true },
  });
  for (const e of employees) {
    const birthday = e.dateOfBirth ? monthDayOf(e.dateOfBirth) : null;
    const joined = monthDayOf(e.dateOfJoining);
    for (const key of keys) {
      if (birthday && recursOn(birthday, key)) {
        items.push({ id: `birthday:${e.id}:${key}`, kind: "birthday", date: key, title: `${e.fullName}'s birthday` });
      }
      const years = Number(key.slice(0, 4)) - e.dateOfJoining.getUTCFullYear();
      if (years >= 1 && recursOn(joined, key)) {
        items.push({
          id: `anniversary:${e.id}:${key}`,
          kind: "anniversary",
          date: key,
          title: `${e.fullName} — ${years} year${years === 1 ? "" : "s"} at Pikorua`,
        });
      }
    }
  }

  // --- Custom employee milestones (recur annually by month/day) -------------
  const customEvents = await prisma.event.findMany({
    where: { type: EventType.custom, scheduledAt: { not: null } },
    include: { employee: { select: { fullName: true } } },
  });
  for (const ev of customEvents) {
    if (!ev.scheduledAt) continue;
    const md = monthDayOf(ev.scheduledAt);
    const label = ev.title ?? "Event";
    for (const key of keys) {
      if (!recursOn(md, key)) continue;
      items.push({
        id: `custom:${ev.id}:${key}`,
        kind: "custom",
        date: key,
        title: ev.employee ? `${ev.employee.fullName} — ${label}` : label,
      });
    }
  }

  // --- Meetings (scoped like GET /events/meetings) --------------------------
  let meetingScope: Prisma.EventWhereInput = {};
  if (!isFinanceRole(session.role)) {
    const viewer = session.employeeId
      ? await prisma.employee.findUnique({ where: { id: session.employeeId }, select: { teamId: true } })
      : null;
    meetingScope = {
      OR: [
        { createdById: session.userId },
        ...(session.employeeId ? [{ invitees: { some: { employeeId: session.employeeId } } }] : []),
        ...(viewer?.teamId ? [{ invitees: { some: { teamId: viewer.teamId } } }] : []),
      ],
    };
  }
  const meetings = await prisma.event.findMany({
    where: { type: EventType.meeting, scheduledAt: { gte: start, lt: end }, ...meetingScope },
  });
  for (const m of meetings) {
    if (!m.scheduledAt) continue;
    items.push({
      id: `meeting:${m.id}`,
      kind: "meeting",
      date: istDateKey(m.scheduledAt),
      at: m.scheduledAt.toISOString(),
      title: m.title ?? "Meeting",
      subtitle: "Meeting",
    });
  }

  return ok({
    week: { start: keys[0], end: keys[6], today: istDateKey(now) },
    items: sortWeekEvents(items),
  });
}
