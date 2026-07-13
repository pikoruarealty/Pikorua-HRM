import { getSession } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/rbac";
import { EmployeeCreateForm } from "@/components/employees/employee-create-form";

export default async function NewEmployeePage() {
  const session = await getSession();
  if (!FINANCE_ROLES.includes(session!.role)) {
    return (
      <p className="text-sm text-muted-foreground">
        Only Admin/HR can create employees.
      </p>
    );
  }

  return <EmployeeCreateForm />;
}
