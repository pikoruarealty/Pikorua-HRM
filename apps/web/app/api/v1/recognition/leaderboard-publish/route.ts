import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { Role } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { audit, clientIp } from "@/lib/audit";
import { RecognitionPeriodType } from "@prisma/client";

// Owner request, 2026-09-06: replaces the old "one Publish button per
// employee row" (that button picked an Employee of the Week/Month winner —
// still available separately at POST /recognition/publish, untouched).
// This is a coarser, department-wide visibility gate: until an Admin
// publishes a (periodType, periodStart, departmentId) combo here, non-
// Admin/HR employees can't see that department's leaderboard at all (see
// GET /recognition). Recomputing does not unpublish — the row is keyed by
// periodStart, not by snapshot content, so a republish is only needed when
// a NEW period starts.

const bodySchema = z.object({
  periodType: z.nativeEnum(RecognitionPeriodType),
  periodStart: z.coerce.date(),
  departmentId: z.string().uuid(),
  published: z.boolean(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (session.role !== Role.admin) return failFor(ErrorCode.FORBIDDEN);

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return fail(ErrorCode.VALIDATION, "Invalid leaderboard-publish payload.", 422);
  const { periodType, periodStart, departmentId, published } = parsed.data;

  if (published) {
    const hasSnapshot = await prisma.recognitionSnapshot.count({
      where: { periodType, periodStart, departmentId },
    });
    if (hasSnapshot === 0) {
      return failFor(
        ErrorCode.VALIDATION,
        "No leaderboard has been computed yet for this department/period — recompute first.",
      );
    }

    await prisma.recognitionLeaderboardPublish.upsert({
      where: { periodType_periodStart_departmentId: { periodType, periodStart, departmentId } },
      create: { periodType, periodStart, departmentId, publishedBy: session.employeeId! },
      update: { publishedAt: new Date(), publishedBy: session.employeeId! },
    });
  } else {
    await prisma.recognitionLeaderboardPublish.deleteMany({
      where: { periodType, periodStart, departmentId },
    });
  }

  await audit({
    action: published ? "recognition.leaderboard_publish" : "recognition.leaderboard_unpublish",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "recognition_leaderboard_publish",
    metadata: {
      period_type: periodType,
      period_start: periodStart.toISOString().slice(0, 10),
      department_id: departmentId,
    },
    ip: clientIp(req),
  });

  return ok({ published });
}
