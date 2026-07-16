import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { pushNotification } from "@/lib/notifications/push";
import { AnnouncementScope, EmployeeStatus, type Announcement } from "@prisma/client";

// Fan a freshly-created announcement out to its audience as per-user
// notifications (in-app bell + FCM push, via the shared pushNotification
// chokepoint). Audience mirrors GET's visibility rules: "all" → every
// active-employee user; "team"/"specific_teams" → active members of the listed
// teams. The creator is never notified of their own post. Fire-and-safe: a
// notification failure must never fail the announcement itself.
async function notifyAnnouncementAudience(
  announcement: Announcement,
  creatorUserId: string,
): Promise<void> {
  try {
    const where =
      announcement.scopeType === AnnouncementScope.all
        ? { employee: { status: EmployeeStatus.active } }
        : { employee: { status: EmployeeStatus.active, teamId: { in: announcement.teamIds } } };

    const recipients = await prisma.user.findMany({
      where: { ...where, id: { not: creatorUserId } },
      select: { id: true },
    });

    // A Notification carries a single `message` string, so fold the
    // announcement's title + body into it — otherwise the notifications page
    // (which renders `message`) would show only the headline, not the content.
    const message = `${announcement.title} — ${announcement.body}`;
    await Promise.allSettled(
      recipients.map((u) => pushNotification(u.id, "announcement", message)),
    );
  } catch (err) {
    console.error(`[announcements] failed to notify audience for ${announcement.id}:`, err);
  }
}

// Track B. GET/POST /api/v1/announcements — Milestone 3.3.
// RBAC: POST — Lead (own team only, scope_type forced to "team"), Admin/HR
// ("all" or "specific_teams"). GET — Any, server-scoped: Admin/HR see
// everything; everyone else sees "all" + "team" announcements for their own
// team + "specific_teams" announcements that list their team.

const createSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  scopeType: z.nativeEnum(AnnouncementScope).optional(),
  teamIds: z.array(z.string().uuid()).optional(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!isFinanceRole(session.role) && !isLeadRole(session.role)) {
    return failFor(ErrorCode.FORBIDDEN);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return failFor(ErrorCode.VALIDATION, "Invalid request body.");
  const { title, body: text } = parsed.data;

  if (isLeadRole(session.role)) {
    if (!session.employeeId) return failFor(ErrorCode.FORBIDDEN, "Session has no linked employee record.");
    const ownTeam = await prisma.team.findFirst({ where: { teamLeadId: session.employeeId } });
    if (!ownTeam) return failFor(ErrorCode.FORBIDDEN, "You do not lead a team.");

    // Forced to scope_type = "team" regardless of what the Lead requested.
    const announcement = await prisma.announcement.create({
      data: {
        title,
        body: text,
        scopeType: AnnouncementScope.team,
        teamIds: [ownTeam.id],
        createdById: session.userId,
      },
    });
    await notifyAnnouncementAudience(announcement, session.userId);
    return ok(announcement, 201);
  }

  // Admin/HR: scope_type = all or specific_teams.
  const scopeType = parsed.data.scopeType;
  if (scopeType !== AnnouncementScope.all && scopeType !== AnnouncementScope.specific_teams) {
    return failFor(ErrorCode.VALIDATION, "scope_type must be 'all' or 'specific_teams' for Admin/HR.");
  }
  if (scopeType === AnnouncementScope.specific_teams) {
    if (!parsed.data.teamIds || parsed.data.teamIds.length === 0) {
      return failFor(ErrorCode.VALIDATION, "team_ids is required when scope_type is 'specific_teams'.");
    }
  }

  const announcement = await prisma.announcement.create({
    data: {
      title,
      body: text,
      scopeType,
      teamIds: scopeType === AnnouncementScope.specific_teams ? parsed.data.teamIds! : [],
      createdById: session.userId,
    },
  });
  await notifyAnnouncementAudience(announcement, session.userId);
  return ok(announcement, 201);
}

export async function GET() {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  if (isFinanceRole(session.role)) {
    const announcements = await prisma.announcement.findMany({ orderBy: { createdAt: "desc" } });
    return ok(announcements);
  }

  if (!session.employeeId) return ok([]);
  const employee = await prisma.employee.findUnique({
    where: { id: session.employeeId },
    select: { teamId: true },
  });
  const teamId = employee?.teamId;

  const announcements = await prisma.announcement.findMany({
    where: {
      OR: [
        { scopeType: AnnouncementScope.all },
        ...(teamId
          ? [
              { scopeType: AnnouncementScope.team, teamIds: { has: teamId } },
              { scopeType: AnnouncementScope.specific_teams, teamIds: { has: teamId } },
            ]
          : []),
      ],
    },
    orderBy: { createdAt: "desc" },
  });
  return ok(announcements);
}
