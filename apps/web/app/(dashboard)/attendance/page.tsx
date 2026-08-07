import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, isLeadRole } from "@/lib/rbac";
import { AttendanceScreen } from "@/components/attendance/attendance-screen";

export default async function AttendancePage() {
  const session = await getSession();
  const isFinance = FINANCE_ROLES.includes(session!.role);
  const isLead = isLeadRole(session!.role);

  return (
    <AttendanceScreen
      canReview={isFinance}
      canSeeAll={isFinance || isLead}
      employeeId={session!.employeeId}
    />
  );
}
