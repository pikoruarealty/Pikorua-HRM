import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, Role, isLeadRole } from "@/lib/rbac";
import { prisma } from "@/lib/db/prisma";
import { AppShell } from "@/components/shell/app-shell";
import { FirstLoginGate } from "@/components/settings/first-login-gate";
import { SALES_ROLES } from "@/lib/sales/provisioning";
import { photoApiPath } from "@/lib/employees/photo";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  // Email for the sidebar profile block (session carries only ids/role).
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { email: true, mustChangePassword: true },
  });

  // Name + photo for the sidebar chip (accounts without an employee record,
  // e.g. a bare admin login, fall back to the email initial).
  const me = session.employeeId
    ? await prisma.employee.findUnique({
        where: { id: session.employeeId },
        select: { id: true, fullName: true, photoUrl: true },
      })
    : null;

  // First-login guard: until the onboarding temp password is replaced, every
  // dashboard route renders the gate instead of the app.
  if (user?.mustChangePassword) {
    return <FirstLoginGate email={user.email} />;
  }

  return (
    <AppShell
      email={user?.email ?? "account"}
      role={session.role}
      employeeId={session.employeeId ?? null}
      fullName={me?.fullName ?? null}
      photoUrl={me ? photoApiPath(me) : null}
      ctx={{
        isFinance: FINANCE_ROLES.includes(session.role),
        isLead: isLeadRole(session.role),
        hasEmployee: !!session.employeeId,
        isAdmin: session.role === Role.admin,
        isSales: (SALES_ROLES as readonly Role[]).includes(session.role),
      }}
    >
      {children}
    </AppShell>
  );
}
