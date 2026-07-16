import {
  LayoutDashboard,
  FolderKanban,
  ListChecks,
  CalendarClock,
  Users,
  UsersRound,
  Building2,
  Clock,
  ReceiptText,
  Settings2,
  FileText,
  Trophy,
  Megaphone,
  CalendarDays,
  CalendarRange,
  Bell,
  Package,
  ScrollText,
  type LucideIcon,
} from "lucide-react";

// RBAC-aware nav model. `show(ctx)` decides visibility per role — a link the
// role can't use is never rendered (the routes still enforce access server-side;
// this keeps forbidden options out of sight entirely, per the product rule).
export type NavCtx = { isFinance: boolean; isLead: boolean; hasEmployee: boolean; isAdmin: boolean };
export type NavItem = { href: string; label: string; icon: LucideIcon; show?: (c: NavCtx) => boolean };
export type NavGroup = { label: string | null; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [{ href: "/", label: "Overview", icon: LayoutDashboard }],
  },
  {
    label: "Work",
    items: [
      { href: "/work", label: "Work Units", icon: FolderKanban, show: (c) => c.isFinance || c.isLead },
      { href: "/my-tasks", label: "My Tasks", icon: ListChecks, show: (c) => c.hasEmployee },
      { href: "/planning", label: "Daily Planning", icon: CalendarClock, show: (c) => c.hasEmployee },
    ],
  },
  {
    label: "People",
    items: [
      { href: "/employees", label: "Employees", icon: Users },
      { href: "/teams", label: "Teams", icon: UsersRound },
      { href: "/departments", label: "Departments", icon: Building2, show: (c) => c.isFinance },
      { href: "/attendance", label: "Attendance", icon: Clock },
    ],
  },
  {
    label: "Money",
    items: [
      { href: "/payslips", label: "Payslips", icon: ReceiptText },
      { href: "/payroll/config", label: "Payroll Config", icon: Settings2, show: (c) => c.isFinance },
      { href: "/requests", label: "Requests", icon: FileText },
    ],
  },
  {
    label: "Culture",
    items: [
      { href: "/calendar", label: "Calendar", icon: CalendarRange },
      { href: "/recognition", label: "Recognition", icon: Trophy },
      { href: "/announcements", label: "Announcements", icon: Megaphone },
      { href: "/events", label: "Events", icon: CalendarDays },
      { href: "/notifications", label: "Notifications", icon: Bell },
      { href: "/assets", label: "Assets", icon: Package, show: (c) => c.isFinance },
    ],
  },
  {
    label: "System",
    items: [{ href: "/audit", label: "Audit Log", icon: ScrollText, show: (c) => c.isAdmin }],
  },
];

/** Flattened, role-filtered nav — used by the sidebar and to resolve the page title. */
export function visibleGroups(ctx: NavCtx): NavGroup[] {
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.show || i.show(ctx)),
  })).filter((g) => g.items.length > 0);
}
