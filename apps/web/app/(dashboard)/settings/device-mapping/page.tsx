import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Role } from "@/lib/rbac";
import { DeviceMappingScreen } from "@/components/settings/device-mapping-screen";

// Biometric device-mapping screen — Admin ONLY (the API enforces this too).
export default async function DeviceMappingPage() {
  const session = await getSession();
  if (session?.role !== Role.admin) redirect("/");
  return <DeviceMappingScreen />;
}
