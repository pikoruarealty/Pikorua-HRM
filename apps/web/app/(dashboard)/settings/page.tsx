import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { SecurityScreen } from "@/components/settings/security-screen";

// Account settings — any authenticated user, self only (the change-password
// API re-verifies the current password server-side).
export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <SecurityScreen />;
}
