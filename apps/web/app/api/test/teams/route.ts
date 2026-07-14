import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { ok, failFor, ErrorCode } from "@/lib/api/response";

// Test-harness only — not part of API_SPEC.md, feeds team dropdowns in
// apps/web/app/test/** (announcements' specific_teams picker, meeting
// invitee-by-team picker). No dedicated GET /teams exists in the real API
// yet (Track A's domain), so this stays under /api/test rather than /api/v1.
export async function GET() {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const teams = await prisma.team.findMany({
    select: { id: true, name: true, departmentId: true, teamLeadId: true },
    orderBy: { name: "asc" },
  });
  return ok(teams);
}
