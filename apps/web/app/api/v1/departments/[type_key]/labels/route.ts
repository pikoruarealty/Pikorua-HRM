import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { requireRole, AuthzError, Role } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";

// Track A. GET — any authenticated role. PUT — Admin only (upsert).
const putSchema = z.object({
  work_unit_label: z.string().min(1),
  sub_unit_label: z.string().min(1),
  work_item_label: z.string().min(1),
  work_item_mode: z.enum(["atomic", "metric"]),
});

export async function GET(
  _req: Request,
  { params }: { params: { type_key: string } },
) {
  const session = await getSession();
  if (!session) {
    return failFor(ErrorCode.UNAUTHENTICATED);
  }

  const labels = await prisma.departmentLabel.findUnique({
    where: { departmentTypeKey: params.type_key },
  });
  if (!labels) {
    return failFor(ErrorCode.NOT_FOUND, "No label config for this department type yet.");
  }

  return ok(labels);
}

export async function PUT(
  req: Request,
  { params }: { params: { type_key: string } },
) {
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

  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return failFor(
      ErrorCode.VALIDATION,
      "work_unit_label, sub_unit_label, work_item_label, and work_item_mode are required.",
    );
  }

  const labels = await prisma.departmentLabel.upsert({
    where: { departmentTypeKey: params.type_key },
    create: {
      departmentTypeKey: params.type_key,
      workUnitLabel: parsed.data.work_unit_label,
      subUnitLabel: parsed.data.sub_unit_label,
      workItemLabel: parsed.data.work_item_label,
      workItemMode: parsed.data.work_item_mode,
    },
    update: {
      workUnitLabel: parsed.data.work_unit_label,
      subUnitLabel: parsed.data.sub_unit_label,
      workItemLabel: parsed.data.work_item_label,
      workItemMode: parsed.data.work_item_mode,
    },
  });

  return ok(labels);
}
