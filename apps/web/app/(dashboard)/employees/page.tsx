import { getSession } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/rbac";
import { EmployeeListScreen } from "@/components/employees/employee-list-screen";

export default async function EmployeesPage() {
  const session = await getSession();
  const canManage = FINANCE_ROLES.includes(session!.role);

  return <EmployeeListScreen canManage={canManage} />;
}
