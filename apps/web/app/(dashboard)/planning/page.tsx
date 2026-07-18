import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Role } from "@/lib/rbac";
import { PlanningScreen } from "@/components/planning/planning-screen";

// Daily Planning (clock-in task selection / EOD) is for task-doers. Admin's
// clock is deliberately hidden and it doesn't plan work items, so redirect it
// home — consistent with the nav hiding this link for Admin. HR still clocks in.
export default async function PlanningPage() {
  const session = await getSession();
  if (session!.role === Role.admin) redirect("/");
  return <PlanningScreen isAdmin={false} />;
}
