import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, isLeadRole } from "@/lib/rbac";
import { WorkUnitDetailScreen } from "@/components/work/work-unit-detail-screen";

export default async function WorkUnitDetailPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  const isFinance = FINANCE_ROLES.includes(session!.role);
  const isLead = isLeadRole(session!.role);

  return (
    <WorkUnitDetailScreen
      workUnitId={params.id}
      isFinance={isFinance}
      isLead={isLead}
      employeeId={session!.employeeId ?? null}
    />
  );
}
