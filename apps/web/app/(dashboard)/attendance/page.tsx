import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, Role, isLeadRole } from "@/lib/rbac";
import { AttendanceScreen } from "@/components/attendance/attendance-screen";

export default async function AttendancePage() {
  const session = await getSession();
  const isFinance = FINANCE_ROLES.includes(session!.role);
  const isLead = isLeadRole(session!.role);

  return (
    <AttendanceScreen
      canReview={isFinance}
      canSeeAll={isFinance || isLead}
      isAdmin={session!.role === Role.admin}
      employeeId={session!.employeeId}
    />
  );
}
