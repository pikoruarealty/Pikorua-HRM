import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { Role } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { audit, clientIp } from "@/lib/audit";
import { EmployeeStatus } from "@prisma/client";

// Track B (owner request, 2026-08-07). DELETE /api/v1/employees/:id/hard-delete
// — Admin-only, permanent removal, distinct from the regular soft-delete DELETE
// on the parent route (which just flips status to inactive and is the normal
// offboarding path). This is for junk/test rows only: the employee must
// already be `inactive`, and MUST have zero rows in every dependent table —
// attendance, payslips, requests, point ledger, daily selections, recognition
// snapshots, documents, assets, events-about, event invitees, assigned work
// items, led teams, led work units. Any real history blocks this permanently;
// use the soft-delete DELETE for anyone who actually worked here.

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (session.role !== Role.admin) return failFor(ErrorCode.FORBIDDEN);

  const employee = await prisma.employee.findUnique({
    where: { id: params.id },
    include: { user: { select: { id: true } } },
  });
  if (!employee) return failFor(ErrorCode.NOT_FOUND, "Employee not found.");
  if (employee.status !== EmployeeStatus.inactive) {
    return failFor(
      ErrorCode.VALIDATION,
      "Employee must be deactivated (soft-deleted) before it can be permanently removed.",
    );
  }

  const [
    ledTeams,
    ledWorkUnits,
    assignedWorkItems,
    dailySelections,
    pointLedger,
    attendanceRecords,
    payslips,
    requests,
    recognitionSnapshots,
    documents,
    assets,
    eventsAbout,
    eventInvitees,
  ] = await Promise.all([
    prisma.team.count({ where: { teamLeadId: params.id } }),
    prisma.workUnit.count({ where: { projectLeadId: params.id } }),
    prisma.workItem.count({ where: { assignedTo: params.id } }),
    prisma.dailyTaskSelection.count({ where: { employeeId: params.id } }),
    prisma.employeePointLedger.count({ where: { employeeId: params.id } }),
    prisma.attendanceRecord.count({ where: { employeeId: params.id } }),
    prisma.payslip.count({ where: { employeeId: params.id } }),
    prisma.request.count({ where: { employeeId: params.id } }),
    prisma.recognitionSnapshot.count({ where: { employeeId: params.id } }),
    prisma.employeeDocument.count({ where: { employeeId: params.id } }),
    prisma.asset.count({ where: { assignedTo: params.id } }),
    prisma.event.count({ where: { employeeId: params.id } }),
    prisma.eventInvitee.count({ where: { employeeId: params.id } }),
  ]);

  const historyCounts = {
    ledTeams,
    ledWorkUnits,
    assignedWorkItems,
    dailySelections,
    pointLedger,
    attendanceRecords,
    payslips,
    requests,
    recognitionSnapshots,
    documents,
    assets,
    eventsAbout,
    eventInvitees,
  };
  const hasHistory = Object.values(historyCounts).some((count) => count > 0);
  if (hasHistory) {
    return failFor(
      ErrorCode.CONFLICT,
      "This employee has history and cannot be permanently deleted. Use deactivate instead.",
    );
  }

  await prisma.$transaction(async (tx) => {
    if (employee.user) {
      await tx.user.delete({ where: { id: employee.user.id } });
    }
    await tx.employee.delete({ where: { id: params.id } });
  });

  await audit({
    action: "employee.hard_delete",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "employee",
    entityId: params.id,
    metadata: { full_name: employee.fullName, email: employee.email },
    ip: clientIp(req),
  });

  return ok({ deleted: true });
}
