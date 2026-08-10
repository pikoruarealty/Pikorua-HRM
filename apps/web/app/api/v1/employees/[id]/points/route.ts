import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { leadsEmployee } from "@/lib/employees/managed-scope";

// Track B. GET /api/v1/employees/:id/points — Milestone 2.3.
// Physically lives under Track A's `app/api/v1/employees/` folder — owned
// by Track B per TRACK_B_TASKLIST 2.3 (same folder-overlap note as the
// 2.2 history endpoint); flag Umang, not a shared-file-list item.

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const employee = await prisma.employee.findUnique({
    where: { id: params.id },
    include: { team: true },
  });
  if (!employee) return failFor(ErrorCode.NOT_FOUND);

  const role = session.role;
  const isSelf = session.employeeId === employee.id;
  const isOwningLead =
    isLeadRole(role) && !!session.employeeId &&
    (await leadsEmployee(session.employeeId, employee.id));
  if (!isFinanceRole(role) && !isOwningLead && !isSelf) {
    return failFor(ErrorCode.FORBIDDEN);
  }

  const ledger = await prisma.employeePointLedger.findMany({
    where: { employeeId: employee.id },
    include: {
      workItem: {
        select: {
          id: true,
          title: true,
          deletedAt: true,
          subUnit: { select: { id: true, name: true, workUnit: { select: { id: true, name: true } } } },
        },
      },
    },
    orderBy: { creditedAt: "desc" },
  });

  // A deleted WorkItem keeps its ledger row so the credit stays auditable, but
  // it must stop counting — otherwise deleting a task entered by mistake leaves
  // its points behind permanently, with no way to take them back. The row is
  // still returned, flagged, so the history explains where the points went.
  const entries = ledger.map(({ workItem, ...rest }) => ({
    ...rest,
    workItem,
    voided: workItem?.deletedAt != null,
  }));
  const balance = entries.reduce((sum, entry) => (entry.voided ? sum : sum + entry.points), 0);

  return ok({ employeeId: employee.id, balance, ledger: entries });
}
