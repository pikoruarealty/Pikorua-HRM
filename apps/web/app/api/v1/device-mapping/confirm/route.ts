import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { Role } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { audit, clientIp } from "@/lib/audit";
import { dateOnly } from "@/lib/attendance/time";
import { reconcileEmployeeDay, type ReconcileOutcome } from "@/lib/integrations/teamoffice/reconcile";

const confirmSchema = z.object({
  deviceUid: z.string().min(1),
  employeeId: z.string().uuid(),
});

// POST /api/v1/device-mapping/confirm — Admin ONLY. The human-confirm half of
// the suggest-and-confirm flow (2026-08-12, Phase 28): links a TeamOffice
// Empcode to an Employee, then reconciles that Empcode's entire unreconciled
// backlog immediately (rather than waiting up to 2 minutes for the next
// scheduled sync) so the Admin sees the effect right away.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (session.role !== Role.admin) {
    return failFor(ErrorCode.FORBIDDEN, "Only Admin can confirm device mapping.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
  }
  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) {
    return failFor(ErrorCode.VALIDATION, parsed.error.issues[0]?.message ?? "Invalid mapping request.");
  }
  const { deviceUid, employeeId } = parsed.data;

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) {
    return failFor(ErrorCode.VALIDATION, "employeeId does not reference an existing employee.");
  }
  if (employee.deviceUid && employee.deviceUid !== deviceUid) {
    return fail(ErrorCode.CONFLICT, "This employee is already mapped to a different deviceUid.", 409);
  }

  // App-level uniqueness — deviceUid is not DB-unique (an unmapped Empcode
  // must stay ingestible for this very screen), so check for a different
  // employee already claiming it before writing.
  const claimedBy = await prisma.employee.findFirst({ where: { deviceUid, id: { not: employeeId } } });
  if (claimedBy) {
    return fail(ErrorCode.CONFLICT, "This deviceUid is already mapped to a different employee.", 409);
  }

  await prisma.employee.update({ where: { id: employeeId }, data: { deviceUid } });

  await audit({
    action: "employee.device_mapping_confirm",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "employee",
    entityId: employeeId,
    metadata: { device_uid: deviceUid },
    ip: clientIp(req),
  });

  // Reconcile the full unreconciled backlog for this Empcode now.
  const backlogDates = await prisma.devicePunchRaw.findMany({
    where: { deviceUid, reconciledAt: null },
    select: { punchTime: true },
    distinct: ["punchTime"],
  });
  const distinctDays = new Set(backlogDates.map((p) => dateOnly(p.punchTime).toISOString()));

  const outcomes: ReconcileOutcome[] = [];
  for (const iso of distinctDays) {
    outcomes.push(await reconcileEmployeeDay(deviceUid, new Date(iso)));
  }

  return ok({
    employeeId,
    deviceUid,
    daysReconciled: outcomes.filter((o) => o.status === "reconciled").length,
    outcomes,
  });
}
