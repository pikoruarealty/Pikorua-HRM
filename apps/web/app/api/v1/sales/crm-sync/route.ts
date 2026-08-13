import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { runCrmSync } from "@/lib/cron/crm-sync";

// POST /api/v1/sales/crm-sync — session-based wrapper around the same
// runCrmSync() the hourly/CRON_SECRET-gated job calls, so Admin/HR or a Sales
// Lead can pull the latest CRM numbers from the /sales dashboard on demand
// instead of waiting for the next :15 tick (mirrors POST
// /recognition/recompute's on-demand pattern).
export async function POST() {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!FINANCE_ROLES.includes(session.role) && !isLeadRole(session.role)) {
    return failFor(ErrorCode.FORBIDDEN);
  }

  const result = await runCrmSync();
  return ok(result);
}
