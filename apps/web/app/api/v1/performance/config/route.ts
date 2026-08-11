import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, isAdmin } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { getPerformanceConfig } from "@/lib/performance/config";
import { audit, clientIp } from "@/lib/audit";

// GET /api/v1/performance/config — Admin/HR; the grace-period switch
// (scoring_enabled) and the self-logged points cap that gate/feed the
// monthly composite score (lib/performance/monthly-score.ts).
export async function GET() {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!FINANCE_ROLES.includes(session.role)) return failFor(ErrorCode.FORBIDDEN);

  const config = await getPerformanceConfig();
  return ok(config);
}

// PUT /api/v1/performance/config — Admin only. Versioned like payroll/config
// and sales/target-config: a new row per edit, never an overwrite, so a
// period already scored under the old settings stays reproducible.
const putSchema = z.object({
  scoring_enabled: z.coerce.boolean(),
  self_logged_cap_percent: z.coerce.number().int().min(0).max(100),
  effective_from: z.coerce.date(),
});

export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!isAdmin(session.role)) {
    return failFor(ErrorCode.FORBIDDEN, "Only Admin can update performance config.");
  }

  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return fail(ErrorCode.VALIDATION, "Invalid performance config payload.", 422);
  }

  const created = await prisma.performanceConfig.create({
    data: {
      scoringEnabled: parsed.data.scoring_enabled,
      selfLoggedCapPercent: parsed.data.self_logged_cap_percent,
      effectiveFrom: parsed.data.effective_from,
    },
  });

  await audit({
    action: "performance_config.update",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "performance_config",
    entityId: created.id,
    metadata: {
      scoring_enabled: parsed.data.scoring_enabled,
      self_logged_cap_percent: parsed.data.self_logged_cap_percent,
      effective_from: parsed.data.effective_from.toISOString().slice(0, 10),
    },
    ip: clientIp(req),
  });

  return ok(created);
}
