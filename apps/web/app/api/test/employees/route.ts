import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { ok, failFor, ErrorCode } from "@/lib/api/response";

// Test-harness only — not part of API_SPEC.md, feeds dropdowns in
// apps/web/app/test/**. No dedicated GET /employees list exists in the real
// API yet (Track A's domain), so this stays under /api/test rather than
// /api/v1. Returns everyone regardless of the caller's own scope — this is
// UI convenience for picking test data, not a real access-controlled route.
export async function GET() {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const employees = await prisma.employee.findMany({
    select: { id: true, fullName: true, role: true, departmentId: true, teamId: true },
    orderBy: { fullName: "asc" },
  });
  return ok(employees);
}
