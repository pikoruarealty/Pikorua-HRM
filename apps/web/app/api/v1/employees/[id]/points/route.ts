import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";

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
  const isOwningLead = isLeadRole(role) && session.employeeId === employee.team?.teamLeadId;
  if (!isFinanceRole(role) && !isOwningLead && !isSelf) {
    return failFor(ErrorCode.FORBIDDEN);
  }

  const ledger = await prisma.employeePointLedger.findMany({
    where: { employeeId: employee.id },
    include: { workItem: { select: { id: true, title: true } } },
    orderBy: { creditedAt: "desc" },
  });

  const balance = ledger.reduce((sum, entry) => sum + entry.points, 0);

  return ok({ employeeId: employee.id, balance, ledger });
}
