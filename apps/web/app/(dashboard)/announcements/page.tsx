import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, Role, isLeadRole } from "@/lib/rbac";
import { AnnouncementsScreen } from "@/components/announcements/announcements-screen";

export default async function AnnouncementsPage() {
  const session = await getSession();
  const canPost = FINANCE_ROLES.includes(session!.role) || isLeadRole(session!.role);
  return (
    <AnnouncementsScreen
      canPost={canPost}
      isFinance={FINANCE_ROLES.includes(session!.role)}
      isAdmin={session!.role === Role.admin}
    />
  );
}
