import { getSession } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/rbac";
import { PayslipsScreen } from "@/components/payroll/payslips-screen";

export default async function PayslipsPage() {
  const session = await getSession();
  return <PayslipsScreen canGenerate={FINANCE_ROLES.includes(session!.role)} />;
}
