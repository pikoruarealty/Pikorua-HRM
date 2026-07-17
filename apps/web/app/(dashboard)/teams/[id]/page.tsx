import { getSession } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/rbac";
import { TeamDetail } from "@/components/teams/team-detail";

export default async function TeamDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  const canManage = FINANCE_ROLES.includes(session!.role);

  return <TeamDetail teamId={params.id} canManage={canManage} />;
}
