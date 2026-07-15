import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, isLeadRole } from "@/lib/rbac";
import { WorkUnitsScreen } from "@/components/work/work-units-screen";

// Track B. Work Units (Projects/Campaigns). Admin/HR or a Team Lead — the
// routes enforce ownership too; this just keeps ICs off the page.
export default async function WorkPage() {
  const session = await getSession();
  const canManage = FINANCE_ROLES.includes(session!.role) || isLeadRole(session!.role);
  if (!canManage) redirect("/");
  return <WorkUnitsScreen />;
}
