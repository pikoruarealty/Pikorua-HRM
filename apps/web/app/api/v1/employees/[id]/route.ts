import { z } from "zod";
import { Prisma, EmployeeStatus, EmploymentType } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, Role, isLeadRole } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { isUuid } from "@/lib/api/params";
import { audit, clientIp } from "@/lib/audit";
import { withPhotoPath } from "@/lib/employees/photo";
import { getLedEmployeeIds } from "@/lib/employees/managed-scope";
import { dateOnly } from "@/lib/attendance/time";
import { reconcileEmployeeDay } from "@/lib/integrations/teamoffice/reconcile";

// Track A. GET/PATCH/DELETE /api/v1/employees/:id — role-scoped per PRD/API_SPEC.

const PUBLIC_SELECT = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  departmentId: true,
  teamId: true,
  role: true,
  employmentType: true,
  requiredDaysPerWeek: true,
  defaultWeeklyOffDay: true,
  dateOfBirth: true,
  dateOfJoining: true,
  deviceUid: true,
  photoUrl: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  // Per-employee sales target overrides (2026-08-10) — not golden-rule data,
  // just numbers a Lead sets for their own team, so they're safe on the
  // public select. Edited via PATCH /employees/:id/sales-targets, not here.
  dailyCallTarget: true,
  monthlySiteVisitTarget: true,
  monthlyBookingTarget: true,
} satisfies Prisma.EmployeeSelect;

// Salary is golden-rule data: only ever exposed to Admin/HR.
const FINANCE_SELECT = {
  ...PUBLIC_SELECT,
  baseSalary: true,
} satisfies Prisma.EmployeeSelect;

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  if (!session) {
    return failFor(ErrorCode.UNAUTHENTICATED);
  }
  if (!isUuid(params.id)) return failFor(ErrorCode.NOT_FOUND);

  const isFinance = FINANCE_ROLES.includes(session.role);
  const isLead = isLeadRole(session.role);

  if (isFinance) {
    const employee = await prisma.employee.findUnique({
      where: { id: params.id },
      select: FINANCE_SELECT,
    });
    if (!employee) return failFor(ErrorCode.NOT_FOUND, "Employee not found.");
    return ok(withPhotoPath(employee));
  }

  if (session.employeeId === params.id) {
    const self = await prisma.employee.findUnique({
      where: { id: params.id },
      select: PUBLIC_SELECT,
    });
    if (!self) return failFor(ErrorCode.NOT_FOUND, "Employee not found.");
    return ok(withPhotoPath(self));
  }

  // A Lead sees everyone across every team they LEAD — not merely the one team
  // they are themselves a member of. Comparing the viewer's own `teamId` made a
  // second led team invisible to its own Lead.
  if (isLead && session.employeeId) {
    const ledIds = await getLedEmployeeIds(session.employeeId);
    if (ledIds.includes(params.id)) {
      const target = await prisma.employee.findUnique({
        where: { id: params.id },
        select: PUBLIC_SELECT,
      });
      if (target) return ok(withPhotoPath(target));
    }
  }

  return failFor(ErrorCode.FORBIDDEN);
}

const patchSchema = z.object({
  base_salary: z.number().positive().optional(),
  department_id: z.string().uuid().nullable().optional(),
  team_id: z.string().uuid().nullable().optional(),
  status: z.nativeEnum(EmployeeStatus).optional(),
  device_uid: z.string().min(1).nullable().optional(),
  employment_type: z.nativeEnum(EmploymentType).optional(),
  required_days_per_week: z.number().int().min(1).max(7).nullable().optional(),
  default_weekly_off_day: z.number().int().min(0).max(6).nullable().optional(),
  // Role change is a privilege-tier change: Admin-only (narrower than the
  // Admin/HR gate on the rest of this route), and handled specially below —
  // it also updates the linked User.role and revokes their sessions.
  role: z.nativeEnum(Role).optional(),
  // 2026-08-07: previously permanently locked after creation — now
  // Admin/HR-editable like everything else on this route.
  full_name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().min(1).nullable().optional(),
  date_of_birth: z.string().nullable().optional(),
  date_of_joining: z.string().optional(),
})
  // Strict (2026-08-11): unknown keys are rejected rather than silently
  // dropped. This route is the mass-assignment surface for salary and role, so
  // a typo'd field name must fail loudly instead of looking like it saved —
  // and `audit.metadata.changed` is Object.keys(d), which was only honest as
  // long as every key in the body was a field we actually applied.
  .strict();

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  if (!session) {
    return failFor(ErrorCode.UNAUTHENTICATED);
  }
  if (!isUuid(params.id)) return failFor(ErrorCode.NOT_FOUND);
  if (!FINANCE_ROLES.includes(session.role)) {
    return failFor(ErrorCode.FORBIDDEN);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return failFor(ErrorCode.VALIDATION, "Invalid request body.");
  }
  const d = parsed.data;

  // Role change is Admin-only and blocked on your own account (an admin
  // demoting themselves would revoke their own session mid-request).
  if (d.role !== undefined) {
    if (session.role !== Role.admin) {
      return failFor(ErrorCode.FORBIDDEN, "Only an admin can change an employee's role.");
    }
    if (session.employeeId === params.id) {
      return failFor(ErrorCode.FORBIDDEN, "You cannot change your own role.");
    }
  }

  if (d.department_id) {
    const dept = await prisma.department.findUnique({ where: { id: d.department_id } });
    if (!dept) return failFor(ErrorCode.VALIDATION, "department_id does not reference an existing department.");
  }
  if (d.team_id) {
    const team = await prisma.team.findUnique({ where: { id: d.team_id } });
    if (!team) return failFor(ErrorCode.VALIDATION, "team_id does not reference an existing team.");
  }
  // deviceUid is not DB-unique (an unmapped Empcode must stay ingestible for
  // the device-mapping suggestion list), so app-level uniqueness is checked
  // here — otherwise two employees could claim the same Empcode and
  // reconciliation would arbitrarily pick one of them.
  if (d.device_uid) {
    const claimedBy = await prisma.employee.findFirst({
      where: { deviceUid: d.device_uid, id: { not: params.id } },
    });
    if (claimedBy) {
      return fail(ErrorCode.CONFLICT, "This deviceUid is already mapped to a different employee.", 409);
    }
  }

  const existing = await prisma.employee.findUnique({
    where: { id: params.id },
    include: { user: { select: { id: true, email: true } } },
  });
  if (!existing) {
    return failFor(ErrorCode.NOT_FOUND, "Employee not found.");
  }

  // Email is @unique on both Employee and User — check both so a PATCH can't
  // collide with someone else's login email either.
  const emailChanged = d.email !== undefined && d.email !== existing.email;
  if (emailChanged) {
    const [emailOnEmployee, emailOnUser] = await Promise.all([
      prisma.employee.findUnique({ where: { email: d.email } }),
      prisma.user.findUnique({ where: { email: d.email } }),
    ]);
    if ((emailOnEmployee && emailOnEmployee.id !== params.id) || (emailOnUser && emailOnUser.id !== existing.user?.id)) {
      return fail(ErrorCode.CONFLICT, "An employee with this email already exists.", 409);
    }
  }

  const roleChanged = d.role !== undefined && d.role !== existing.role;

  const employee = await prisma.employee.update({
    where: { id: params.id },
    data: {
      ...(d.base_salary !== undefined ? { baseSalary: d.base_salary } : {}),
      ...(d.department_id !== undefined ? { departmentId: d.department_id } : {}),
      ...(d.team_id !== undefined ? { teamId: d.team_id } : {}),
      ...(d.status !== undefined ? { status: d.status } : {}),
      ...(d.device_uid !== undefined ? { deviceUid: d.device_uid } : {}),
      ...(d.employment_type !== undefined ? { employmentType: d.employment_type } : {}),
      ...(d.required_days_per_week !== undefined ? { requiredDaysPerWeek: d.required_days_per_week } : {}),
      ...(d.default_weekly_off_day !== undefined ? { defaultWeeklyOffDay: d.default_weekly_off_day } : {}),
      ...(d.role !== undefined ? { role: d.role } : {}),
      ...(d.full_name !== undefined ? { fullName: d.full_name } : {}),
      ...(d.email !== undefined ? { email: d.email } : {}),
      ...(d.phone !== undefined ? { phone: d.phone } : {}),
      ...(d.date_of_birth !== undefined
        ? { dateOfBirth: d.date_of_birth ? new Date(d.date_of_birth) : null }
        : {}),
      ...(d.date_of_joining !== undefined ? { dateOfJoining: new Date(d.date_of_joining) } : {}),
    },
    select: FINANCE_SELECT,
  });

  // Keep the authorization source (User.role, read by getSession) in sync with
  // the display role, and bump tokenVersion so the employee's existing JWTs are
  // revoked — their next request forces a re-login under the new permission tier.
  // Email edits get the same treatment: User.email is the login identifier
  // (see /auth/login), so it must track Employee.email or the employee's
  // profile and login credentials silently diverge.
  if ((roleChanged || emailChanged) && existing.user) {
    await prisma.user.update({
      where: { id: existing.user.id },
      data: {
        ...(roleChanged ? { role: d.role } : {}),
        ...(emailChanged ? { email: d.email } : {}),
        ...(roleChanged ? { tokenVersion: { increment: 1 } } : {}),
      },
    });
  }

  // A newly-mapped Empcode may already have punches sitting unreconciled
  // (the near-universal order of events: device punches arrive, THEN an
  // Admin/HR gets around to mapping them) — reconcile its backlog immediately
  // rather than waiting for the next 2-minute poll to sweep it up.
  const deviceUidChanged = d.device_uid !== undefined && d.device_uid !== existing.deviceUid;
  if (deviceUidChanged && d.device_uid) {
    const backlogDates = await prisma.devicePunchRaw.findMany({
      where: { deviceUid: d.device_uid, reconciledAt: null },
      select: { punchTime: true },
    });
    const distinctDays = new Set(backlogDates.map((p) => dateOnly(p.punchTime).toISOString()));
    for (const iso of distinctDays) {
      await reconcileEmployeeDay(d.device_uid, new Date(iso));
    }
  }

  // Salary changes are exactly what an HR audit trail exists for — record
  // old → new alongside the other touched fields (viewer is Admin-only).
  await audit({
    action: "employee.update",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "employee",
    entityId: params.id,
    metadata: {
      changed: Object.keys(d),
      ...(d.base_salary !== undefined
        ? { base_salary_before: Number(existing.baseSalary), base_salary_after: d.base_salary }
        : {}),
      ...(d.status !== undefined ? { status_after: d.status } : {}),
      ...(roleChanged ? { role_before: existing.role, role_after: d.role } : {}),
      ...(emailChanged ? { email_before: existing.email, email_after: d.email } : {}),
    },
    ip: clientIp(req),
  });

  return ok(withPhotoPath(employee));
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  if (!session) {
    return failFor(ErrorCode.UNAUTHENTICATED);
  }
  if (!isUuid(params.id)) return failFor(ErrorCode.NOT_FOUND);
  if (session.role !== Role.admin) {
    return failFor(ErrorCode.FORBIDDEN);
  }

  const existing = await prisma.employee.findUnique({ where: { id: params.id } });
  if (!existing) {
    return failFor(ErrorCode.NOT_FOUND, "Employee not found.");
  }

  // Soft-delete only — status flips to inactive, row never removed.
  const employee = await prisma.employee.update({
    where: { id: params.id },
    data: { status: EmployeeStatus.inactive },
    select: FINANCE_SELECT,
  });

  // Revoke the deactivated employee's login sessions (bumps token_version so
  // any outstanding JWT is rejected on its next getSession()).
  await prisma.user.updateMany({
    where: { employeeId: params.id },
    data: { tokenVersion: { increment: 1 } },
  });

  await audit({
    action: "employee.deactivate",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "employee",
    entityId: params.id,
    ip: clientIp(_req),
  });

  return ok(withPhotoPath(employee));
}
