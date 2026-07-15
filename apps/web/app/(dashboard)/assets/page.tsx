import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/rbac";
import { AssetsScreen } from "@/components/assets/assets-screen";

// PRD §5.12 — asset management is deferred to a later phase. This is the stub
// placeholder (GET /assets returns []). Admin/HR only.
export default async function AssetsPage() {
  const session = await getSession();
  if (!FINANCE_ROLES.includes(session!.role)) redirect("/");
  return <AssetsScreen />;
}
