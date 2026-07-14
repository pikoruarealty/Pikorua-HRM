import { getSession } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/rbac";
import { PayslipDetail } from "@/components/payroll/payslip-detail";

export default async function PayslipDetailPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  return <PayslipDetail id={params.id} canFinalize={FINANCE_ROLES.includes(session!.role)} />;
}
