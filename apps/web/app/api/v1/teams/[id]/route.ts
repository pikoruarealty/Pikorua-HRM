import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { requireRole, isLeadRole, AuthzError, FINANCE_ROLES } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";

// Track A. PATCH /api/v1/teams/:id — Admin/HR; reassign lead and/or rename.
const patchSchema = z.object({
  name: z.string().min(1).optional(),
  team_lead_id: z.string().uuid().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
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

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return failFor(ErrorCode.VALIDATION, "name and/or team_lead_id must be valid.");
  }

  const team = await prisma.team.findUnique({ where: { id: params.id } });
  if (!team) {
    return failFor(ErrorCode.NOT_FOUND, "Team not found.");
  }

  if (parsed.data.team_lead_id) {
    const lead = await prisma.employee.findUnique({ where: { id: parsed.data.team_lead_id } });
    if (!lead) {
      return failFor(ErrorCode.VALIDATION, "team_lead_id does not reference an existing employee.");
    }
    if (!isLeadRole(lead.role)) {
      return fail(
        ErrorCode.VALIDATION,
        "team_lead_id must reference an employee with a lead role.",
        422,
      );
    }
  }

  const updated = await prisma.team.update({
    where: { id: params.id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.team_lead_id !== undefined
        ? { teamLeadId: parsed.data.team_lead_id }
        : {}),
    },
    include: {
      department: { select: { id: true, name: true, typeKey: true } },
      teamLead: { select: { id: true, fullName: true } },
    },
  });

  return ok(updated);
}

// DELETE /api/v1/teams/:id — Admin/HR. Hard-delete, but only when the team
// has no members left — reassign/remove employees from the team first.
// (Teams have no soft-delete/status field in the schema, unlike Employees.)
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  try {
    requireRole(session, FINANCE_ROLES);
  } catch (err) {
    if (err instanceof AuthzError) return failFor(err.kind);
    throw err;
  }

  const team = await prisma.team.findUnique({ where: { id: params.id } });
  if (!team) {
    return failFor(ErrorCode.NOT_FOUND, "Team not found.");
  }

  const memberCount = await prisma.employee.count({ where: { teamId: params.id } });
  if (memberCount > 0) {
    return fail(
      ErrorCode.CONFLICT,
      `Cannot delete team "${team.name}": it still has ${memberCount} employee(s) assigned. Reassign or remove them first.`,
      409,
    );
  }

  try {
    await prisma.team.delete({ where: { id: params.id } });
  } catch (err) {
    // Covers any other FK reference to this team (e.g. Track B's event_invitees)
    // that isn't visible from the Team/Employee relation alone.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      return fail(
        ErrorCode.CONFLICT,
        `Cannot delete team "${team.name}": other records still reference it.`,
        409,
      );
    }
    throw err;
  }

  return ok({ id: params.id });
}
