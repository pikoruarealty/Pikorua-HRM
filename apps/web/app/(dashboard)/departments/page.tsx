import { getSession } from "@/lib/auth";
import { Role } from "@/lib/rbac";
import { DepartmentsScreen } from "@/components/departments/departments-screen";

// Admin-only screen (docs/TRACK_A_TASKS.md §1.1). The GET API itself allows
// any authenticated role, but the config UI is deliberately Admin-only.
export default async function DepartmentsPage() {
  const session = await getSession();
  if (session?.role !== Role.admin) {
    return (
      <p className="text-sm text-muted-foreground">
        Department configuration is only available to Admins.
      </p>
    );
  }

  return <DepartmentsScreen />;
}
