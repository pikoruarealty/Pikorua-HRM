import { getSession } from "@/lib/auth";
import { isFinanceRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";

// Track B. GET /api/v1/assets — PLACEHOLDER ONLY.
//
// Real asset management is explicitly deferred (PRD §5.12, CLAUDE.md
// "Deferred" list). This endpoint exists so the route is reserved and returns
// a valid, empty `{ data, error }` envelope — nothing more should be built
// here in v1. RBAC = Admin/HR only (asset inventory is a finance/admin concern).
export async function GET() {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!isFinanceRole(session.role)) return failFor(ErrorCode.FORBIDDEN);

  // Intentionally empty — asset management beyond this stub is out of scope.
  return ok([]);
}
