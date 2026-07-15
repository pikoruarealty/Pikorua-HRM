import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { EmployeeStatus, EventType, RequestStatus, RequestType, type Prisma } from "@prisma/client";

// Track A (2026-07-15). GET /api/v1/calendar?month=&year= — one feed for the
// /calendar page: everything in the system that has a date, RBAC-scoped
// server-side:
//   - holidays                     → everyone (company-wide)
//   - birthdays / anniversaries    → everyone (celebratory, PRD §5.11)
//   - meetings                     → Admin/HR all; others only meetings they
//                                    created or are invited to (self or team)
//                                    — same scoping as GET /events/meetings
//   - leave (paid/unpaid requests) → Admin/HR all; Lead own team; Employee self
// Multi-day leave is expanded to one item per day (clipped to the month) so
// the month grid can render without client-side range math.

export type CalendarItemKind = "holiday" | "birthday" | "anniversary" | "meeting" | "leave";

type CalendarItem = {
  id: string;
  kind: CalendarItemKind;
  date: string; // YYYY-MM-DD
  title: string;
  subtitle?: string;
  employeeId?: string;
  holidayId?: string; // set on holiday items so Admin/HR can delete from the UI
  status?: "pending" | "approved";
  time?: string; // HH:MM for meetings
};

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const now = new Date();
  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month") ? Number(searchParams.get("month")) : now.getUTCMonth() + 1;
  const year = searchParams.get("year") ? Number(searchParams.get("year")) : now.getUTCFullYear();
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2100) {
    return failFor(ErrorCode.VALIDATION, "month must be 1-12 and year a four-digit year.");
  }

  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const nextMonthStart = new Date(Date.UTC(year, month, 1));
  const items: CalendarItem[] = [];

  const finance = isFinanceRole(session.role);
  const lead = isLeadRole(session.role);

  // Viewer's team (for lead-scoped leave + team meeting invites).
  const viewer = session.employeeId
    ? await prisma.employee.findUnique({ where: { id: session.employeeId }, select: { teamId: true } })
    : null;

  // --- Holidays (everyone) -------------------------------------------------
  const holidays = await prisma.holiday.findMany({
    where: { date: { gte: monthStart, lt: nextMonthStart } },
    orderBy: { date: "asc" },
  });
  for (const h of holidays) {
    items.push({
      id: `holiday:${h.id}`,
      kind: "holiday",
      date: isoDay(h.date),
      title: h.name,
      subtitle: "Company holiday",
      holidayId: h.id,
    });
  }

  // --- Birthdays & anniversaries (everyone, derived) -----------------------
  const employees = await prisma.employee.findMany({
    where: { status: EmployeeStatus.active },
    select: { id: true, fullName: true, dateOfBirth: true, dateOfJoining: true },
  });
  for (const e of employees) {
    if (e.dateOfBirth && e.dateOfBirth.getUTCMonth() + 1 === month) {
      items.push({
        id: `birthday:${e.id}`,
        kind: "birthday",
        date: isoDay(new Date(Date.UTC(year, month - 1, e.dateOfBirth.getUTCDate()))),
        title: `${e.fullName}'s birthday`,
        employeeId: e.id,
      });
    }
    const joinYears = year - e.dateOfJoining.getUTCFullYear();
    if (e.dateOfJoining.getUTCMonth() + 1 === month && joinYears >= 1) {
      items.push({
        id: `anniversary:${e.id}`,
        kind: "anniversary",
        date: isoDay(new Date(Date.UTC(year, month - 1, e.dateOfJoining.getUTCDate()))),
        title: `${e.fullName} — ${joinYears} year${joinYears === 1 ? "" : "s"} at Pikorua`,
        employeeId: e.id,
      });
    }
  }

  // --- Meetings (scoped like GET /events/meetings) --------------------------
  const meetingScope: Prisma.EventWhereInput = finance
    ? {}
    : {
        OR: [
          { createdById: session.userId },
          ...(session.employeeId ? [{ invitees: { some: { employeeId: session.employeeId } } }] : []),
          ...(viewer?.teamId ? [{ invitees: { some: { teamId: viewer.teamId } } }] : []),
        ],
      };
  // A non-finance user with no employee record and no created meetings would
  // produce an empty OR (matches nothing is what we want — Prisma treats
  // empty OR as false only when the array is empty, which it never is here
  // because createdById is always present).
  const meetings = await prisma.event.findMany({
    where: {
      type: EventType.meeting,
      scheduledAt: { gte: monthStart, lt: nextMonthStart },
      ...meetingScope,
    },
    orderBy: { scheduledAt: "asc" },
  });
  for (const m of meetings) {
    if (!m.scheduledAt) continue;
    items.push({
      id: `meeting:${m.id}`,
      kind: "meeting",
      date: isoDay(m.scheduledAt),
      time: m.scheduledAt.toISOString().slice(11, 16),
      title: m.title ?? "Meeting",
      subtitle: "Meeting",
    });
  }

  // --- Leave (requests with a date range) -----------------------------------
  let leaveEmployeeScope: Prisma.RequestWhereInput | null = null;
  if (finance) {
    leaveEmployeeScope = {};
  } else if (lead && viewer?.teamId) {
    leaveEmployeeScope = { employee: { teamId: viewer.teamId } };
  } else if (session.employeeId) {
    leaveEmployeeScope = { employeeId: session.employeeId };
  }

  if (leaveEmployeeScope) {
    const leaves = await prisma.request.findMany({
      where: {
        type: { in: [RequestType.leave_paid, RequestType.leave_unpaid] },
        status: { in: [RequestStatus.approved, RequestStatus.pending] },
        dateFrom: { lt: nextMonthStart },
        dateTo: { gte: monthStart },
        ...leaveEmployeeScope,
      },
      include: { employee: { select: { id: true, fullName: true } } },
    });
    for (const leave of leaves) {
      if (!leave.dateFrom || !leave.dateTo) continue;
      const label = leave.type === RequestType.leave_paid ? "Paid leave" : "Unpaid leave";
      const rangeNote =
        isoDay(leave.dateFrom) === isoDay(leave.dateTo)
          ? label
          : `${label} (${isoDay(leave.dateFrom)} → ${isoDay(leave.dateTo)})`;
      // Expand to one item per day, clipped to the requested month.
      const from = leave.dateFrom < monthStart ? monthStart : leave.dateFrom;
      for (
        let d = new Date(from);
        d < nextMonthStart && d <= leave.dateTo;
        d = new Date(d.getTime() + 24 * 60 * 60 * 1000)
      ) {
        items.push({
          id: `leave:${leave.id}:${isoDay(d)}`,
          kind: "leave",
          date: isoDay(d),
          title: `${leave.employee.fullName} — ${label.toLowerCase()}`,
          subtitle: rangeNote,
          employeeId: leave.employee.id,
          status: leave.status === RequestStatus.approved ? "approved" : "pending",
        });
      }
    }
  }

  items.sort((a, b) => (a.date === b.date ? a.kind.localeCompare(b.kind) : a.date.localeCompare(b.date)));

  return ok({ month, year, items });
}
