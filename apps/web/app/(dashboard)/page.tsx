import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, isLeadRole } from "@/lib/rbac";
import { HomeScreen } from "@/components/home/home-screen";

// Dashboard landing (path "/", inside the (dashboard) route group). Replaces
// the old Phase-0 app/page.tsx placeholder. Auth-gated by the group layout.
export default async function HomePage() {
  const session = await getSession();
  return (
    <HomeScreen
      isFinance={FINANCE_ROLES.includes(session!.role)}
      isLead={isLeadRole(session!.role)}
      hasEmployee={!!session!.employeeId}
    />
  );
}
