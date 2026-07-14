import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import LogoutButton from "./_lib/logout-button";

const NAV = [
  { href: "/test", label: "Home" },
  { href: "/test/work-units", label: "Work Units" },
  { href: "/test/work-items", label: "My Work Items" },
  { href: "/test/requests", label: "Requests" },
  { href: "/test/daily-planning", label: "Daily Planning" },
  { href: "/test/points", label: "Points" },
  { href: "/test/history", label: "Growth History" },
  { href: "/test/recognition", label: "Recognition" },
  { href: "/test/notifications", label: "Notifications" },
  { href: "/test/announcements", label: "Announcements" },
  { href: "/test/documents", label: "Documents" },
  { href: "/test/events", label: "Events" },
  { href: "/test/payslips", label: "Payslips" },
  { href: "/test/assets", label: "Assets" },
];

// Basic test-UI shell — not the final dashboard design. Gates on a real
// session (server-side, via the shared getSession()) rather than duplicating
// auth logic client-side.
export default async function TestLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="container mx-auto flex flex-wrap items-center justify-between gap-4 px-4 py-3">
          <nav className="flex flex-wrap gap-4 text-sm">
            {NAV.map((item) => (
              <a key={item.href} href={item.href} className="text-muted-foreground hover:text-foreground">
                {item.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">
              {session.role} {session.employeeId ? `· ${session.employeeId}` : ""}
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="container mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
