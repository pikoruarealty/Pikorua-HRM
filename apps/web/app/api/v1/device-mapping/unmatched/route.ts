import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { Role } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { EmployeeStatus } from "@prisma/client";
import { downloadPunchDataMCID } from "@/lib/integrations/teamoffice/client";
import { bestNameMatches } from "@/lib/util/string-similarity";
import { createLogger } from "@/lib/log";

const logger = createLogger("teamoffice");

// GET /api/v1/device-mapping/unmatched — Admin ONLY (mirrors /audit-logs:
// device-mapping decisions are an Admin call, not an HR one). Suggest-and-
// confirm screen (2026-08-12, Phase 28): lists Empcodes seen on the biometric
// device that don't map to any Employee yet, with a best-guess name match
// against currently-unmapped active employees. Nothing here writes anything —
// POST /device-mapping/confirm is the only mutation.
export async function GET() {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (session.role !== Role.admin) {
    return failFor(ErrorCode.FORBIDDEN, "Only Admin can view device mapping.");
  }

  const mappedDeviceUids = await prisma.employee.findMany({
    where: { deviceUid: { not: null } },
    select: { deviceUid: true },
  });
  const mappedSet = new Set(mappedDeviceUids.map((e) => e.deviceUid as string));

  const grouped = await prisma.devicePunchRaw.groupBy({
    by: ["deviceUid"],
    where: { reconciledAt: null },
    _count: { _all: true },
    _min: { punchTime: true },
    _max: { punchTime: true },
  });
  const unmatchedGroups = grouped.filter((g) => !mappedSet.has(g.deviceUid));

  const unmappedEmployees = await prisma.employee.findMany({
    where: { deviceUid: null, status: EmployeeStatus.active },
    select: { id: true, fullName: true },
  });
  const nameOptions = unmappedEmployees.map((e) => ({ id: e.id, name: e.fullName }));

  const rows = await Promise.all(
    unmatchedGroups.map(async (g) => {
      let name: string | null = null;
      const from = g._min.punchTime ?? new Date();
      const to = g._max.punchTime ?? new Date();
      try {
        const punches = await downloadPunchDataMCID(g.deviceUid, from, to);
        name = punches.find((p) => p.name)?.name ?? null;
      } catch (err) {
        logger.error("failed to fetch name for unmatched deviceUid", {
          deviceUid: g.deviceUid,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const suggestions = name
        ? bestNameMatches(name, nameOptions).filter((s) => s.similarity > 0.4)
        : [];

      return {
        deviceUid: g.deviceUid,
        name,
        punchCount: g._count._all,
        firstSeen: g._min.punchTime,
        lastSeen: g._max.punchTime,
        suggestions: suggestions.map((s) => ({
          employeeId: s.id,
          fullName: s.name,
          similarity: Math.round(s.similarity * 100) / 100,
        })),
      };
    }),
  );

  return ok({ unmatched: rows });
}
