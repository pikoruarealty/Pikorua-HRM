import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/rbac";
import { DashboardNav } from "@/components/dashboard-nav";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen">
      <DashboardNav
        role={session.role}
        isFinance={FINANCE_ROLES.includes(session.role)}
      />
      <main className="container mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
