import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { ScoringConfigScreen } from "@/components/settings/scoring-config-screen";

export default async function ScoringSettingsPage() {
  const session = await getSession();
  return <ScoringConfigScreen canEdit={isAdmin(session!.role)} />;
}
