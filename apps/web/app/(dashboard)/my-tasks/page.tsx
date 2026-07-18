import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Role } from "@/lib/rbac";
import { MyTasksScreen } from "@/components/work/my-tasks-screen";

// My Tasks is for task-doers (Leads/Employees/HR). Admin oversees rather than
// does and never gets assigned work items, so a direct visit redirects home
// rather than showing an empty page — matches the nav hiding this for Admin.
export default async function MyTasksPage() {
  const session = await getSession();
  if (session!.role === Role.admin) redirect("/");
  return <MyTasksScreen />;
}
