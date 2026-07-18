import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, isLeadRole } from "@/lib/rbac";
import { EmployeeListScreen } from "@/components/employees/employee-list-screen";

export default async function EmployeesPage() {
  const session = await getSession();
  const canManage = FINANCE_ROLES.includes(session!.role);
  const isLead = isLeadRole(session!.role);

  // The employee directory is a management view. A plain employee would only
  // ever see themselves here — send them to their own profile instead (the
  // same target as "My Profile" in the account menu), matching the nav which
  // hides this tab for non-managers.
  if (!canManage && !isLead) {
    if (session!.employeeId) redirect(`/employees/${session!.employeeId}`);
    redirect("/");
  }

  return <EmployeeListScreen canManage={canManage} />;
}
