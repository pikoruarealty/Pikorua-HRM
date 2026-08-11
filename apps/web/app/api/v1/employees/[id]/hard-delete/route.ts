import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { Role } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { audit, clientIp } from "@/lib/audit";
import { EmployeeStatus, PayslipStatus } from "@prisma/client";

// Track B. DELETE /api/v1/employees/:id/hard-delete
// — Admin-only permanent removal. If the employee has assigned work items or
// led projects, the client MUST supply `reassign_to` (an active employee id)
// in the JSON body; otherwise the route returns 409 with
// `requiresReassignment: true` and the UI shows a picker dialog.

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (session.role !== Role.admin) return failFor(ErrorCode.FORBIDDEN);

  try {
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

    // Read reassign_to from JSON body
    let reassignToId: string | null = null;
    try {
      const body = await req.json().catch(() => null);
      if (body?.reassign_to && typeof body.reassign_to === "string") {
        reassignToId = body.reassign_to;
      }
    } catch {
      // no body provided
    }

    // Count work that needs reassignment before we proceed
    const [assignedWorkItemsCount, ledWorkUnitsCount] = await Promise.all([
      prisma.workItem.count({ where: { assignedTo: params.id, deletedAt: null } }),
      prisma.workUnit.count({ where: { projectLeadId: params.id, deletedAt: null } }),
    ]);

    const hasWorkToReassign = assignedWorkItemsCount > 0 || ledWorkUnitsCount > 0;

    // If there is work to reassign but no target was provided, tell the client
    // to show the reassignment dialog — do not auto-pick a fallback.
    if (hasWorkToReassign && !reassignToId) {
      return failFor(
        ErrorCode.CONFLICT,
        `This employee has ${assignedWorkItemsCount} assigned task(s) and leads ${ledWorkUnitsCount} project(s). Please choose someone to reassign their work to before deleting.`,
        { requiresReassignment: true, assignedWorkItems: assignedWorkItemsCount, ledWorkUnits: ledWorkUnitsCount },
      );
    }

    // Finalized payslips are a permanent financial record — the normal
    // DELETE /payslips/:id route already refuses to remove one (409 unless
    // it's still a draft). Hard-deleting the employee must not be a
    // back door around that: it would silently destroy issued payroll
    // history with no trace beyond this audit log entry's metadata.
    const finalizedPayslipsCount = await prisma.payslip.count({
      where: { employeeId: params.id, status: PayslipStatus.finalized },
    });
    if (finalizedPayslipsCount > 0) {
      return failFor(
        ErrorCode.CONFLICT,
        `This employee has ${finalizedPayslipsCount} finalized payslip(s), which are a permanent payroll record and cannot be destroyed by deleting the employee. Unfinalize them first if they genuinely need to go, or leave this employee soft-deleted instead of hard-deleting.`,
        { finalizedPayslips: finalizedPayslipsCount },
      );
    }

    // Validate the reassignment target (must be an active employee, not the one being deleted)
    let fallbackEmployeeId: string | null = null;
    if (reassignToId) {
      const target = await prisma.employee.findFirst({
        where: { id: reassignToId, status: EmployeeStatus.active },
        select: { id: true },
      });
      if (!target) {
        return failFor(ErrorCode.VALIDATION, "The selected reassignment employee was not found or is not active.");
      }
      fallbackEmployeeId = target.id;
    }

    let reassignedCount = 0;

    await prisma.$transaction(async (tx) => {
      // 1. Reassign or clean up WorkUnits where this employee is projectLead
      const ledWorkUnits = await tx.workUnit.findMany({
        where: { projectLeadId: params.id },
        select: { id: true },
      });
      if (ledWorkUnits.length > 0) {
        if (fallbackEmployeeId) {
          await tx.workUnit.updateMany({
            where: { projectLeadId: params.id },
            data: { projectLeadId: fallbackEmployeeId },
          });
        } else {
          // No other employee exists — clean up orphaned work items & units
          for (const wu of ledWorkUnits) {
            await tx.dailyTaskSelection.deleteMany({
              where: { workItem: { subUnit: { workUnitId: wu.id } } },
            });
            await tx.employeePointLedger.deleteMany({
              where: { workItem: { subUnit: { workUnitId: wu.id } } },
            });
            await tx.workItem.deleteMany({
              where: { subUnit: { workUnitId: wu.id } },
            });
            await tx.subUnit.deleteMany({
              where: { workUnitId: wu.id },
            });
          }
          await tx.workUnit.deleteMany({ where: { projectLeadId: params.id } });
        }
      }

      // 2. Reassign WorkItems assigned to this employee
      const assignedWorkItems = await tx.workItem.findMany({
        where: { assignedTo: params.id },
        include: {
          subUnit: {
            select: {
              workUnit: {
                select: { projectLeadId: true },
              },
            },
          },
        },
      });

      for (const wi of assignedWorkItems) {
        const leadId = wi.subUnit?.workUnit?.projectLeadId;
        // Prefer explicit reassign_to, then the project lead (if not the employee being deleted)
        const targetAssignee =
          fallbackEmployeeId ?? (leadId && leadId !== params.id ? leadId : null);

        if (targetAssignee) {
          await tx.workItem.update({
            where: { id: wi.id },
            data: { assignedTo: targetAssignee },
          });
          reassignedCount++;
        } else {
          await tx.dailyTaskSelection.deleteMany({ where: { workItemId: wi.id } });
          await tx.employeePointLedger.deleteMany({ where: { workItemId: wi.id } });
          await tx.workItem.delete({ where: { id: wi.id } });
        }
      }

      // 3. Unlink Team leadership
      await tx.team.updateMany({
        where: { teamLeadId: params.id },
        data: { teamLeadId: null },
      });

      // 4. Clean up employee-specific operational records
      await tx.dailyTaskSelection.deleteMany({ where: { employeeId: params.id } });
      await tx.employeePointLedger.deleteMany({ where: { employeeId: params.id } });
      await tx.recognitionSnapshot.deleteMany({ where: { employeeId: params.id } });
      await tx.request.deleteMany({ where: { employeeId: params.id } });
      await tx.attendanceRecord.deleteMany({ where: { employeeId: params.id } });
      await tx.payslip.deleteMany({ where: { employeeId: params.id } });
      await tx.employeeDocument.deleteMany({ where: { employeeId: params.id } });
      await tx.eventInvitee.deleteMany({ where: { employeeId: params.id } });
      await tx.weeklyOffMove.deleteMany({ where: { employeeId: params.id } });

      // Nullify references in asset and event
      await tx.event.updateMany({
        where: { employeeId: params.id },
        data: { employeeId: null },
      });
      await tx.asset.updateMany({
        where: { assignedTo: params.id },
        data: { assignedTo: null },
      });

      // 5. Clean up User-level records and User if attached
      if (employee.user) {
        const uid = employee.user.id;
        await tx.passwordResetToken.deleteMany({ where: { userId: uid } });
        await tx.pushToken.deleteMany({ where: { userId: uid } });
        await tx.notification.deleteMany({ where: { userId: uid } });

        // Nullify or reassign actor references on other records
        await tx.auditLog.updateMany({
          where: { actorUserId: uid },
          data: { actorUserId: null },
        });
        await tx.weeklyOffMove.updateMany({
          where: { revertedById: uid },
          data: { revertedById: null },
        });
        await tx.attendanceRecord.updateMany({
          where: { approvedById: uid },
          data: { approvedById: null },
        });
        await tx.request.updateMany({
          where: { approverId: uid },
          data: { approverId: null },
        });
        await tx.payslip.updateMany({
          where: { generatedById: uid },
          data: { generatedById: session.userId },
        });
        await tx.announcement.updateMany({
          where: { createdById: uid },
          data: { createdById: session.userId },
        });
        await tx.event.updateMany({
          where: { createdById: uid },
          data: { createdById: null },
        });
        await tx.holiday.updateMany({
          where: { createdById: uid },
          data: { createdById: null },
        });

        await tx.user.delete({ where: { id: uid } });
      }

      // 6. Delete the employee record
      await tx.employee.delete({ where: { id: params.id } });
    });

    await audit({
      action: "employee.hard_delete",
      actorUserId: session.userId,
      actorRole: session.role,
      entityType: "employee",
      entityId: params.id,
      metadata: {
        full_name: employee.fullName,
        email: employee.email,
        reassigned_work_items: reassignedCount,
        reassigned_to: fallbackEmployeeId,
      },
      ip: clientIp(req),
    });

    return ok({ deleted: true, reassignedWorkItems: reassignedCount });
  } catch (err) {
    console.error("[hard-delete] unexpected error:", err);
    return failFor(ErrorCode.INTERNAL, "Failed to permanently delete employee. Check server logs.");
  }
}

// GET /api/v1/employees/:id/hard-delete
// Returns a summary of pending work that needs to be reassigned before deletion.
// Used by the UI to decide whether to show the reassignment picker dialog.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (session.role !== Role.admin) return failFor(ErrorCode.FORBIDDEN);

  try {
    const employee = await prisma.employee.findUnique({
      where: { id: params.id },
      select: { id: true, status: true },
    });
    if (!employee) return failFor(ErrorCode.NOT_FOUND, "Employee not found.");

    const [assignedWorkItems, ledWorkUnits, finalizedPayslips] = await Promise.all([
      prisma.workItem.count({ where: { assignedTo: params.id, deletedAt: null } }),
      prisma.workUnit.count({ where: { projectLeadId: params.id, deletedAt: null } }),
      prisma.payslip.count({ where: { employeeId: params.id, status: PayslipStatus.finalized } }),
    ]);

    return ok({ assignedWorkItems, ledWorkUnits, finalizedPayslips });
  } catch (err) {
    console.error("[hard-delete GET] unexpected error:", err);
    return failFor(ErrorCode.INTERNAL, "Failed to fetch pending work counts.");
  }
}
