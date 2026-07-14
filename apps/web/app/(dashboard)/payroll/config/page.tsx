import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { PayrollConfigScreen } from "@/components/payroll/payroll-config-screen";

export default async function PayrollConfigPage() {
  const session = await getSession();
  return <PayrollConfigScreen canEdit={isAdmin(session!.role)} />;
}
