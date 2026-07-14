"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Role } from "@prisma/client";
import { Button } from "@/components/ui/button";

// Shared top-level nav shell — Track A links live here now; Track B adds its
// own links as its screens land. Not on the CLAUDE.md shared-file list, but
// touched by both tracks in practice, so keep additions additive.
const LINKS: { href: string; label: string; financeOnly?: boolean }[] = [
  { href: "/employees", label: "Employees" },
  { href: "/teams", label: "Teams" },
  { href: "/departments", label: "Departments", financeOnly: true },
  { href: "/attendance", label: "Attendance" },
  { href: "/payslips", label: "Payslips" },
  { href: "/payroll/config", label: "Payroll Config", financeOnly: true },
];

export function DashboardNav({
  isFinance,
}: {
  role: Role;
  isFinance: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="border-b">
      <div className="container mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <nav className="flex items-center gap-6">
          <span className="font-semibold">Pikorua HRM</span>
          {LINKS.filter((l) => !l.financeOnly || isFinance).map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={
                pathname?.startsWith(l.href)
                  ? "text-sm font-medium text-foreground"
                  : "text-sm font-medium text-muted-foreground hover:text-foreground"
              }
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <Button variant="outline" size="sm" onClick={logout}>
          Sign out
        </Button>
      </div>
    </header>
  );
}
