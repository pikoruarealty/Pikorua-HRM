import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Role } from "@/lib/rbac";
import { AuditScreen } from "@/components/audit/audit-screen";

// Audit trail viewer — Admin ONLY (the API enforces this too; HR's own
// actions are part of the trail, so its reader is the narrowest role).
export default async function AuditPage() {
  const session = await getSession();
  if (session?.role !== Role.admin) redirect("/");
  return <AuditScreen />;
}
