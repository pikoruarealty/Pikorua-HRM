import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, requireRole, AuthzError } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { audit, clientIp } from "@/lib/audit";

// Track A (2026-07-15). GET /api/v1/holidays — any authenticated role (the
// holiday list is company-wide, shown on /calendar). POST — Admin/HR only,
// audited. One holiday per calendar date.

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const { searchParams } = new URL(req.url);
  const yearParam = searchParams.get("year");
  const year = yearParam ? Number(yearParam) : undefined;
  if (yearParam && (!Number.isInteger(year) || year! < 2000 || year! > 2100)) {
    return failFor(ErrorCode.VALIDATION, "year must be a four-digit year.");
  }

  const holidays = await prisma.holiday.findMany({
    where: year
      ? { date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } }
      : undefined,
    orderBy: { date: "asc" },
  });
  return ok(holidays);
}

const createSchema = z.object({
  // Calendar date, no time component.
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  name: z.string().min(1).max(200),
});

export async function POST(req: Request) {
  const session = await getSession();
  try {
    requireRole(session, FINANCE_ROLES);
  } catch (err) {
    if (err instanceof AuthzError) return failFor(err.kind);
    throw err;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return failFor(ErrorCode.VALIDATION, parsed.error.issues[0]?.message ?? "Invalid holiday.");
  }

  const date = new Date(`${parsed.data.date}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return failFor(ErrorCode.VALIDATION, "date is not a valid calendar date.");
  }

  const existing = await prisma.holiday.findUnique({ where: { date } });
  if (existing) {
    return fail(ErrorCode.CONFLICT, `A holiday already exists on ${parsed.data.date} (${existing.name}).`, 409);
  }

  const holiday = await prisma.holiday.create({
    data: {
      date,
      name: parsed.data.name.trim(),
      createdById: session!.userId,
    },
  });

  await audit({
    action: "holiday.create",
    actorUserId: session!.userId,
    actorRole: session!.role,
    entityType: "holiday",
    entityId: holiday.id,
    metadata: { date: parsed.data.date, name: holiday.name },
    ip: clientIp(req),
  });

  return ok(holiday, 201);
}
