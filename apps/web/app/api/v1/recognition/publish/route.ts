import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { Role } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { audit, clientIp } from "@/lib/audit";
import { RecognitionPeriodType } from "@prisma/client";

// Track B (owner request, 2026-08-07). POST /api/v1/recognition/publish —
// Admin-only. Employee of the Week/Month is no longer auto-selected (see
// lib/cron/recognition.ts) — the admin picks a winner per department/period
// off the reference leaderboard (GET /recognition) and publishes them here.
// Publishing clears any existing published winner for the SAME
// periodType+periodStart+departmentId (one winner per department per
// period, matching the old auto-selection's per-department shape), then
// marks the chosen row isEmployeeOfMonth/selectedManually/publishedAt. If
// the picked employee has no snapshot row yet for this period (e.g. zero
// score so they got filtered, or the snapshot predates them), a manual row
// is created for them (rank 0 signals "manually inserted, not computed").

const bodySchema = z.object({
  periodType: z.nativeEnum(RecognitionPeriodType),
  periodStart: z.coerce.date(),
  departmentId: z.string().uuid(),
  employeeId: z.string().uuid(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (session.role !== Role.admin) return failFor(ErrorCode.FORBIDDEN);

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return fail(ErrorCode.VALIDATION, "Invalid publish payload.", 422);
  const { periodType, periodStart, departmentId, employeeId } = parsed.data;

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return failFor(ErrorCode.VALIDATION, "employeeId does not reference an existing employee.");
  if (employee.departmentId !== departmentId) {
    return failFor(ErrorCode.VALIDATION, "employeeId does not belong to departmentId.");
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.recognitionSnapshot.updateMany({
      where: { periodType, periodStart, departmentId, isEmployeeOfMonth: true },
      data: { isEmployeeOfMonth: false, selectedManually: false, publishedAt: null },
    });

    const existing = await tx.recognitionSnapshot.findFirst({
      where: { periodType, periodStart, departmentId, employeeId },
    });

    if (existing) {
      await tx.recognitionSnapshot.update({
        where: { id: existing.id },
        data: { isEmployeeOfMonth: true, selectedManually: true, publishedAt: now },
      });
    } else {
      await tx.recognitionSnapshot.create({
        data: {
          periodType,
          periodStart,
          departmentId,
          employeeId,
          score: 0,
          rank: 0,
          isEmployeeOfMonth: true,
          selectedManually: true,
          publishedAt: now,
        },
      });
    }
  });

  await audit({
    action: "recognition.publish",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "recognition_snapshot",
    metadata: {
      period_type: periodType,
      period_start: periodStart.toISOString().slice(0, 10),
      department_id: departmentId,
      employee_id: employeeId,
    },
    ip: clientIp(req),
  });

  return ok({ published: true });
}
