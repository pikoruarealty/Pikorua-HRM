import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { RequestType, RequestStatus, Role } from "@prisma/client";

// Who may file their own request, in hierarchy order: Employee -> approved by
// Lead's superiors (HR/Admin); Lead -> approved by HR/Admin; HR -> approved by
// Admin (self-approval blocked in approve/reject). Admin has no one above it,
// so Admin is intentionally not included here (would create an unapprovable
// pending request).
const CAN_SUBMIT_ROLES: readonly Role[] = [
  Role.tech_employee,
  Role.sales_employee,
  Role.bde,
  Role.tech_lead,
  Role.sales_lead,
  Role.hr,
];

// Track B. GET/POST /api/v1/requests — Milestone 1.3 (leave type only).

const LEAVE_TYPES: RequestType[] = [RequestType.leave_paid, RequestType.leave_unpaid];

const createSchema = z.object({
  type: z.nativeEnum(RequestType),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  description: z.string().optional(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!CAN_SUBMIT_ROLES.includes(session.role)) return failFor(ErrorCode.FORBIDDEN);
  if (!session.employeeId) return failFor(ErrorCode.FORBIDDEN, "Session has no linked employee record.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return failFor(ErrorCode.VALIDATION, "Invalid request body.");
  }
  const { type, dateFrom, dateTo, description } = parsed.data;

  if (!LEAVE_TYPES.includes(type)) {
    return failFor(ErrorCode.NOT_IMPLEMENTED, "Only leave_paid and leave_unpaid requests are supported until Milestone 2.");
  }
  if (!dateFrom || !dateTo) {
    return failFor(ErrorCode.VALIDATION, "dateFrom and dateTo are required for leave requests.");
  }
  if (dateTo < dateFrom) {
    return failFor(ErrorCode.VALIDATION, "dateTo must be on or after dateFrom.");
  }

  const request = await prisma.request.create({
    data: {
      employeeId: session.employeeId,
      type,
      dateFrom,
      dateTo,
      description,
      status: RequestStatus.pending,
    },
  });

  return ok(request, 201);
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const { searchParams } = new URL(req.url);
  const typeFilter = searchParams.get("type") as RequestType | null;
  const statusFilter = searchParams.get("status") as RequestStatus | null;
  const employeeIdFilter = searchParams.get("employee_id") ?? undefined;

  const role = session.role;

  if (isFinanceRole(role)) {
    const requests = await prisma.request.findMany({
      where: {
        type: typeFilter ?? undefined,
        status: statusFilter ?? undefined,
        employeeId: employeeIdFilter,
      },
      orderBy: { createdAt: "desc" },
    });
    return ok(requests);
  }

  if (!session.employeeId) return ok([]);

  if (isLeadRole(role)) {
    const teams = await prisma.team.findMany({
      where: { teamLeadId: session.employeeId },
      select: { members: { select: { id: true } } },
    });
    // Own team's members plus the Lead's own submitted requests (Leads can
    // now file their own leave, approved up the chain by HR/Admin).
    const scopedEmployeeIds = [...new Set([...teams.flatMap((t) => t.members.map((m) => m.id)), session.employeeId])];

    const requests = await prisma.request.findMany({
      where: {
        employeeId: employeeIdFilter ? employeeIdFilter : { in: scopedEmployeeIds },
        type: typeFilter ?? undefined,
        status: statusFilter ?? undefined,
      },
      orderBy: { createdAt: "desc" },
    });
    // A Lead may only ever see their own team's requests + their own, even via employee_id filter.
    return ok(requests.filter((r) => scopedEmployeeIds.includes(r.employeeId)));
  }

  // Employee: self only.
  const requests = await prisma.request.findMany({
    where: {
      employeeId: session.employeeId,
      type: typeFilter ?? undefined,
      status: statusFilter ?? undefined,
    },
    orderBy: { createdAt: "desc" },
  });
  return ok(requests);
}
