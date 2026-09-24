import { z } from "zod";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, isAdmin } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { getTaskReminderConfig, saveTaskReminderConfig } from "@/lib/notifications/task-reminders-config";
import { TaskReminderContentMode, TaskReminderScope } from "@prisma/client";
import { audit, clientIp } from "@/lib/audit";

// GET /api/v1/task-reminders/config — Admin/HR (matches Scoring & Targets'
// view/edit split: HR can see how reminders are configured, only Admin edits).
export async function GET() {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!FINANCE_ROLES.includes(session.role)) return failFor(ErrorCode.FORBIDDEN);

  const config = await getTaskReminderConfig();
  return ok(config);
}

// PUT /api/v1/task-reminders/config — Admin only. Not versioned (see the
// TaskReminderConfig schema comment) — this replaces the single live row.
const putSchema = z.object({
  enabled: z.coerce.boolean(),
  interval_minutes: z.coerce.number().int().min(5).max(1440),
  content_mode: z.nativeEnum(TaskReminderContentMode),
  scope: z.nativeEnum(TaskReminderScope),
});

export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!isAdmin(session.role)) {
    return failFor(ErrorCode.FORBIDDEN, "Only Admin can update task reminder settings.");
  }

  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return fail(ErrorCode.VALIDATION, "Invalid task reminder config payload.", 422);
  }

  const saved = await saveTaskReminderConfig({
    enabled: parsed.data.enabled,
    intervalMinutes: parsed.data.interval_minutes,
    contentMode: parsed.data.content_mode,
    scope: parsed.data.scope,
  });

  await audit({
    action: "task_reminder_config.update",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "task_reminder_config",
    entityId: "singleton",
    metadata: parsed.data,
    ip: clientIp(req),
  });

  return ok(saved);
}
