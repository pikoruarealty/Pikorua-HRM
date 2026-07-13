import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { requireRole, AuthzError, Role } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";

// Track A. GET /api/v1/departments — any authenticated role; POST — Admin only.
const createSchema = z.object({
  name: z.string().min(1),
  type_key: z.string().min(1),
});

export async function GET() {
  const session = await getSession();
  if (!session) {
    return failFor(ErrorCode.UNAUTHENTICATED);
  }

  const departments = await prisma.department.findMany({
    orderBy: { name: "asc" },
  });
  const labels = await prisma.departmentLabel.findMany({
    where: { departmentTypeKey: { in: departments.map((d) => d.typeKey) } },
  });
  const labelsByTypeKey = new Map(labels.map((l) => [l.departmentTypeKey, l]));

  return ok(
    departments.map((d) => ({
      id: d.id,
      name: d.name,
      typeKey: d.typeKey,
      createdAt: d.createdAt,
      labels: labelsByTypeKey.get(d.typeKey) ?? null,
    })),
  );
}

export async function POST(req: Request) {
  const session = await getSession();
  try {
    requireRole(session, [Role.admin]);
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
    return failFor(ErrorCode.VALIDATION, "name and type_key are required.");
  }

  const existing = await prisma.department.findFirst({
    where: { typeKey: parsed.data.type_key },
  });
  if (existing) {
    return fail(
      ErrorCode.CONFLICT,
      `A department with type_key "${parsed.data.type_key}" already exists.`,
      409,
    );
  }

  const department = await prisma.department.create({
    data: { name: parsed.data.name, typeKey: parsed.data.type_key },
  });

  return ok(department, 201);
}
