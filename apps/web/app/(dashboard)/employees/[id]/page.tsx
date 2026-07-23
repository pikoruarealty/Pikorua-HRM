import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { FINANCE_ROLES, Role, isLeadRole } from "@/lib/rbac";
import { EmployeeDetail } from "@/components/employees/employee-detail";

export default async function EmployeeDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  const canManage = FINANCE_ROLES.includes(session!.role);
  const isAdmin = session!.role === Role.admin;
  const isSelf = session!.employeeId === params.id;

  // Attendance panel: same viewers the underlying GET /attendance* endpoints
  // already allow — Admin/HR via canManage, the employee themself via isSelf,
  // and (matching employees/:id/task-activity's own RBAC) the Lead who owns
  // this employee's team.
  let isOwningLead = false;
  if (!canManage && !isSelf && isLeadRole(session!.role) && session!.employeeId) {
    const employee = await prisma.employee.findUnique({
      where: { id: params.id },
      select: { team: { select: { teamLeadId: true } } },
    });
    isOwningLead = employee?.team?.teamLeadId === session!.employeeId;
  }
  const canViewAttendance = canManage || isSelf || isOwningLead;

  return (
    <EmployeeDetail
      employeeId={params.id}
      canManage={canManage}
      isAdmin={isAdmin}
      canViewAttendance={canViewAttendance}
      isSelf={isSelf}
    />
  );
}
