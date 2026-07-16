import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, Role, isLeadRole } from "@/lib/rbac";
import { prisma } from "@/lib/db/prisma";
import { AppShell } from "@/components/shell/app-shell";
import { FirstLoginGate } from "@/components/settings/first-login-gate";

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

  // First-login guard: until the onboarding temp password is replaced, every
  // dashboard route renders the gate instead of the app.
  if (user?.mustChangePassword) {
    return <FirstLoginGate email={user.email} />;
  }

  return (
    <AppShell
      email={user?.email ?? "account"}
      role={session.role}
      ctx={{
        isFinance: FINANCE_ROLES.includes(session.role),
        isLead: isLeadRole(session.role),
        hasEmployee: !!session.employeeId,
        isAdmin: session.role === Role.admin,
      }}
    >
      {children}
    </AppShell>
  );
}
