import { getSession } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/rbac";
import { TeamsScreen } from "@/components/teams/teams-screen";

export default async function TeamsPage() {
  const session = await getSession();
  const canManage = FINANCE_ROLES.includes(session!.role);

  return <TeamsScreen canManage={canManage} />;
}
