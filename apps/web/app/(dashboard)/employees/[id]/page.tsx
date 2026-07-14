import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, Role } from "@/lib/rbac";
import { EmployeeDetail } from "@/components/employees/employee-detail";

export default async function EmployeeDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  const canManage = FINANCE_ROLES.includes(session!.role);
  const isAdmin = session!.role === Role.admin;
  // Attendance panel: same viewers the underlying GET /attendance* endpoints
  // already allow for "self" (Admin/HR covered by canManage; Lead-of-team
  // isn't special-cased here since no other part of this page differentiates
  // Leads yet either — the API will 403 and the panel shows that error if a
  // Lead without access somehow lands here).
  const canViewAttendance = canManage || session!.employeeId === params.id;

  return (
    <EmployeeDetail
      employeeId={params.id}
      canManage={canManage}
      isAdmin={isAdmin}
      canViewAttendance={canViewAttendance}
    />
  );
}
