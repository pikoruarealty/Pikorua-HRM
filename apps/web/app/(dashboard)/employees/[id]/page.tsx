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

  return <EmployeeDetail employeeId={params.id} canManage={canManage} isAdmin={isAdmin} />;
}
