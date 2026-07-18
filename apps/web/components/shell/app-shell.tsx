"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Menu, X, Sun, Moon, LogOut, Hexagon, ChevronsUpDown, ShieldCheck, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { visibleGroups, type NavCtx } from "@/components/shell/nav-config";
import { useTheme } from "@/lib/hooks/use-theme";

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  hr: "HR",
  tech_lead: "Tech Lead",
  sales_lead: "Sales Lead",
  tech_employee: "Tech",
  sales_employee: "Sales",
  bde: "BDE",
};

function NavContent({
  ctx,
  unread,
  dark,
  toggleTheme,
  onNavigate,
  navRef,
}: {
  ctx: NavCtx;
  unread: number;
  dark: boolean;
  toggleTheme: () => void;
  onNavigate?: () => void;
  navRef?: React.RefObject<HTMLElement>;
}) {
  const pathname = usePathname();
  const groups = visibleGroups(ctx);
  if (!groups.some((g) => g.label === "System")) {
    groups.push({ label: "System", items: [] });
  }

  function isActive(href: string) {
    return href === "/" ? pathname === "/" : pathname?.startsWith(href);
  }

  return (
    <nav
      ref={navRef as React.RefObject<HTMLElement>}
      className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-3 py-4"
    >
      {groups.map((group, gi) => (
        <div key={gi} className="flex flex-col gap-1">
          {group.label && (
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">
              {group.label}
            </p>
          )}
          {group.items.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-white"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-white",
                )}
              >
                <Icon
                  className={cn(
                    "size-[18px] shrink-0",
                    active ? "text-brand" : "text-sidebar-muted group-hover:text-sidebar-foreground",
                  )}
                  strokeWidth={2}
                />
                <span className="flex-1">{item.label}</span>
                {item.href === "/notifications" && unread > 0 && (
                  <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-semibold text-brand-foreground">
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </Link>
            );
          })}
          {group.label === "System" && (
            <button
              onClick={toggleTheme}
              className="group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-white"
            >
              {dark ? (
                <Sun className="size-[18px] shrink-0 text-sidebar-muted group-hover:text-sidebar-foreground" strokeWidth={2} />
              ) : (
                <Moon className="size-[18px] shrink-0 text-sidebar-muted group-hover:text-sidebar-foreground" strokeWidth={2} />
              )}
              <span className="flex-1 text-left">{dark ? "Light mode" : "Dark mode"}</span>
            </button>
          )}
        </div>
      ))}
    </nav>
  );
}

function SidebarInner({
  ctx,
  unread,
  email,
  role,
  employeeId,
  onNavigate,
  onLogout,
}: {
  ctx: NavCtx;
  unread: number;
  email: string;
  role: string;
  employeeId: string | null;
  onNavigate?: () => void;
  onLogout: () => void;
}) {
  const [dark, toggleTheme] = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [menuOpen]);

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <Link
        href="/"
        onClick={() => {
          navRef.current?.scrollTo({ top: 0, behavior: "smooth" });
          onNavigate?.();
        }}
        className="flex h-16 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-5"
      >
        <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-brand-foreground">
          <Hexagon className="size-5" strokeWidth={2.25} />
        </span>
        <span className="text-[15px] font-semibold tracking-tight text-white">Pikorua HRM</span>
      </Link>

      <NavContent
        ctx={ctx}
        unread={unread}
        dark={dark}
        toggleTheme={toggleTheme}
        onNavigate={onNavigate}
        navRef={navRef}
      />

      <div ref={menuRef} className="relative shrink-0 border-t border-sidebar-border p-3">
        {menuOpen && (
          <div className="animate-in fade-in slide-in-from-bottom-2 absolute inset-x-3 bottom-[calc(100%+0.5rem)] z-10 overflow-hidden rounded-xl border border-white/10 bg-sidebar-accent p-1.5 shadow-2xl shadow-black/50 ring-1 ring-white/10 duration-150">
            {employeeId && (
              <Link
                href={`/employees/${employeeId}`}
                onClick={() => setMenuOpen(false)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-white/10 hover:text-white"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-white/10">
                  <UserRound className="size-4" />
                </span>
                My Profile
              </Link>
            )}
            <Link
              href="/settings"
              onClick={() => setMenuOpen(false)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-white/10 hover:text-white"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-white/10">
                <ShieldCheck className="size-4" />
              </span>
              Account Security
            </Link>
            <div className="my-1 h-px bg-white/10" />
            <button
              onClick={() => {
                setMenuOpen(false);
                onLogout();
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-red-500/10">
                <LogOut className="size-4" />
              </span>
              Sign out
            </button>
          </div>
        )}

        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-sidebar-accent/60"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-sm font-semibold uppercase text-white">
            {email.slice(0, 1)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{email}</p>
            <p className="text-xs text-sidebar-muted">{ROLE_LABELS[role] ?? role}</p>
          </div>
          <ChevronsUpDown className="size-4 shrink-0 text-sidebar-muted" />
        </button>
      </div>
    </div>
  );
}

export function AppShell({
  ctx,
  email,
  role,
  employeeId,
  children,
}: {
  ctx: NavCtx;
  email: string;
  role: string;
  employeeId: string | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let active = true;
    async function poll() {
      try {
        const res = await fetch("/api/v1/notifications");
        const json = await res.json();
        if (active && json.data?.notifications) {
          setUnread(json.data.notifications.filter((n: { readAt: string | null }) => !n.readAt).length);
        }
      } catch {}
    }
    poll();
    const id = setInterval(poll, 60_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  async function logout() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-[100dvh]">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 overflow-hidden border-r border-sidebar-border md:block">
        <SidebarInner ctx={ctx} unread={unread} email={email} role={role} employeeId={employeeId} onLogout={logout} />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-72 overflow-hidden border-r border-sidebar-border shadow-xl">
            <button
              onClick={() => setOpen(false)}
              className="absolute right-3 top-4 z-10 rounded-md p-1.5 text-sidebar-muted hover:text-white"
              aria-label="Close menu"
            >
              <X className="size-5" />
            </button>
            <SidebarInner
              ctx={ctx}
              unread={unread}
              email={email}
              role={role}
              employeeId={employeeId}
              onNavigate={() => setOpen(false)}
              onLogout={logout}
            />
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-h-[100dvh] flex-col md:pl-64">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur md:hidden">
          <Button variant="outline" size="icon" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </Button>
          <span className="flex items-center gap-2 font-semibold">
            <span className="flex size-7 items-center justify-center rounded-md bg-brand text-brand-foreground">
              <Hexagon className="size-4" strokeWidth={2.25} />
            </span>
            Pikorua HRM
          </span>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
