import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { isFinanceRole } from "@/lib/rbac";
import { audit, clientIp } from "@/lib/audit";

// GET /api/v1/adhoc-task-types (2026-08-10) — the fixed catalog an employee
// picks from when logging their own task. Readable by any authenticated user:
// it is the menu on the self-log form, and its points are policy an Admin set,
// not anyone's private data.
//
// Inactive types stay in the table (older WorkItems still point at them) but
// are hidden here, so a retired type can't be chosen again. Admin/HR can ask
// for the full list with ?includeInactive=1 to manage it.

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const includeInactive =
    new URL(req.url).searchParams.get("includeInactive") === "1" && isFinanceRole(session.role);

  const types = await prisma.adhocTaskType.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    select: { id: true, key: true, label: true, points: true, active: true, sortOrder: true },
  });
  return ok(types);
}

// POST /api/v1/adhoc-task-types — Admin/HR. Adds a new catalog entry an
// employee can pick from on the self-log form. `key` is the stable
// machine-readable identifier WorkItems reference — immutable once created,
// unlike `label`/`points`, which an Admin may want to reword or reprice.
const postSchema = z
  .object({
    key: z.string().min(1).max(50).regex(/^[a-z][a-z0-9_]*$/, "key must be lowercase snake_case"),
    label: z.string().min(1).max(100),
    points: z.number().int().min(1).max(100),
    sortOrder: z.number().int().optional(),
  })
  .strict();

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!isFinanceRole(session.role)) return failFor(ErrorCode.FORBIDDEN);

  const body = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return fail(ErrorCode.VALIDATION, "Invalid ad-hoc task type payload.", 422);
  }

  const dupe = await prisma.adhocTaskType.findUnique({ where: { key: parsed.data.key } });
  if (dupe) {
    return fail(ErrorCode.CONFLICT, `An ad-hoc task type with key "${parsed.data.key}" already exists.`, 409);
  }

  const created = await prisma.adhocTaskType.create({
    data: {
      key: parsed.data.key,
      label: parsed.data.label,
      points: parsed.data.points,
      sortOrder: parsed.data.sortOrder ?? 0,
    },
  });

  await audit({
    action: "adhoc_task_type.create",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "adhoc_task_type",
    entityId: created.id,
    metadata: { key: created.key, label: created.label, points: created.points },
    ip: clientIp(req),
  });

  return ok(created);
}
