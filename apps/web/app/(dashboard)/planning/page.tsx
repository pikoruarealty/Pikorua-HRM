import { getSession } from "@/lib/auth";
import { Role } from "@/lib/rbac";
import { PlanningScreen } from "@/components/planning/planning-screen";

export default async function PlanningPage() {
  const session = await getSession();
  return <PlanningScreen isAdmin={session!.role === Role.admin} />;
}
