import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { isUuid } from "@/lib/api/params";
import { audit, clientIp } from "@/lib/audit";

// PATCH /api/v1/adhoc-task-types/:id — Admin/HR. `key` is deliberately not
// editable here — it is what WorkItem.selfLog reads and older WorkItems keep
// pointing at it, so renaming it out from under them would be silent data
// corruption. Retiring a type is `active: false`, not delete, for the same
// reason (SCHEMA.md — adhoc_task_types).
const patchSchema = z
  .object({
    label: z.string().min(1).max(100).optional(),
    points: z.number().int().min(1).max(100).optional(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  })
  .strict();

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!isFinanceRole(session.role)) return failFor(ErrorCode.FORBIDDEN);
  if (!isUuid(params.id)) return failFor(ErrorCode.NOT_FOUND);

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return fail(ErrorCode.VALIDATION, "Invalid ad-hoc task type payload.", 422);
  }
  const d = parsed.data;

  const existing = await prisma.adhocTaskType.findUnique({ where: { id: params.id } });
  if (!existing) return failFor(ErrorCode.NOT_FOUND, "Ad-hoc task type not found.");

  const updated = await prisma.adhocTaskType.update({
    where: { id: params.id },
    data: {
      ...(d.label !== undefined ? { label: d.label } : {}),
      ...(d.points !== undefined ? { points: d.points } : {}),
      ...(d.active !== undefined ? { active: d.active } : {}),
      ...(d.sortOrder !== undefined ? { sortOrder: d.sortOrder } : {}),
    },
  });

  await audit({
    action: "adhoc_task_type.update",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "adhoc_task_type",
    entityId: params.id,
    metadata: { changed: Object.keys(d), key: existing.key },
    ip: clientIp(req),
  });

  return ok(updated);
}
