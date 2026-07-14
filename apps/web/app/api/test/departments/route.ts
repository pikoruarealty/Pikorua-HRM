import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { ok, failFor, ErrorCode } from "@/lib/api/response";

// Test-harness only — not part of API_SPEC.md, feeds dropdowns in
// apps/web/app/test/**. No dedicated GET /departments exists in the real API
// yet (Track A's domain), so this stays under /api/test rather than /api/v1.
export async function GET() {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const departments = await prisma.department.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return ok(departments);
}
