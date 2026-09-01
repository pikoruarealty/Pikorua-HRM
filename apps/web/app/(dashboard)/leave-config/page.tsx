import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { LeaveConfigScreen } from "@/components/leave/leave-config-screen";

export default async function LeaveConfigPage() {
  const session = await getSession();
  return <LeaveConfigScreen canEdit={isAdmin(session!.role)} />;
}
