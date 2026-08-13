import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, isLeadRole, type Role } from "@/lib/rbac";
import { SalesScreen } from "@/components/sales/sales-screen";
import { SALES_ROLES } from "@/lib/sales/provisioning";

// Sales activity page (Pillar 5, 2026-08-10). Open to the people it is about
// (sales roles, who file offline claims and read their own row) and the people
// who manage them (Leads, Admin/HR). A tech employee has nothing here, so they
// are bounced rather than shown an empty dashboard — the APIs scope
// independently regardless.
export default async function SalesPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const isFinance = FINANCE_ROLES.includes(session.role);
  const isLead = isLeadRole(session.role);
  const isSalesPerson = (SALES_ROLES as readonly Role[]).includes(session.role);
  if (!isFinance && !isLead && !isSalesPerson) redirect("/");

  return (
    <SalesScreen
      employeeId={session.employeeId}
      canReview={isFinance || isLead}
      canClaim={isSalesPerson}
    />
  );
}
