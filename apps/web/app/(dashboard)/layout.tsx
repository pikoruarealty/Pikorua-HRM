import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, isLeadRole } from "@/lib/rbac";
import { prisma } from "@/lib/db/prisma";
import { AppShell } from "@/components/shell/app-shell";

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
    select: { email: true },
  });

  return (
    <AppShell
      email={user?.email ?? "account"}
      role={session.role}
      ctx={{
        isFinance: FINANCE_ROLES.includes(session.role),
        isLead: isLeadRole(session.role),
        hasEmployee: !!session.employeeId,
      }}
    >
      {children}
    </AppShell>
  );
}
