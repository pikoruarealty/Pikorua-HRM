import {
  LayoutDashboard,
  FolderKanban,
  ListChecks,
  CalendarClock,
  Users,
  UsersRound,
  Building2,
  Clock,
  PhoneCall,
  ReceiptText,
  Settings2,
  FileText,
  Trophy,
  Star,
  Megaphone,
  CalendarDays,
  CalendarRange,
  Bell,
  Package,
  ScrollText,
  Fingerprint,
  type LucideIcon,
} from "lucide-react";

// RBAC-aware nav model. `show(ctx)` decides visibility per role — a link the
// role can't use is never rendered (the routes still enforce access server-side;
// this keeps forbidden options out of sight entirely, per the product rule).
export type NavCtx = {
  isFinance: boolean;
  isLead: boolean;
  hasEmployee: boolean;
  isAdmin: boolean;
  /** Sales-side role (sales employee/lead, BDE) — they have their own activity
   *  dashboard that a tech employee has no use for. */
  isSales: boolean;
};
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
      // My Tasks / Daily Planning are for people who get assigned work items and
      // clock in against them. Admin oversees rather than does, and its clock is
      // deliberately hidden — so these are hidden for Admin entirely rather than
      // shown-then-empty. HR still clocks in, so it keeps them.
      { href: "/my-tasks", label: "My Tasks", icon: ListChecks, show: (c) => c.hasEmployee && !c.isAdmin },
      { href: "/planning", label: "Daily Planning", icon: CalendarClock, show: (c) => c.hasEmployee && !c.isAdmin },
    ],
  },
  {
    label: "People",
    items: [
      // The Employees directory is a management view (Admin/HR see everyone,
      // a Lead sees their team). A plain employee only ever sees themselves in
      // it, which is pointless — their own details live behind "My Profile" in
      // the account menu instead. So hide the tab for non-managers.
      { href: "/employees", label: "Employees", icon: Users, show: (c) => c.isFinance || c.isLead },
      { href: "/teams", label: "Teams", icon: UsersRound },
      { href: "/departments", label: "Departments", icon: Building2, show: (c) => c.isFinance },
      { href: "/attendance", label: "Attendance", icon: Clock },
      // Sales activity (Pillar 5) — calls/site visits/bookings against target,
      // plus the offline-call claim flow. Shown to the sales side and to anyone
      // who manages them; a tech employee has nothing to do here.
      {
        href: "/sales",
        label: "Sales Activity",
        icon: PhoneCall,
        show: (c) => c.isFinance || c.isLead || c.isSales,
      },
      // Monthly quality review (Pillar 3) — a Lead/Admin-side entry sheet. An
      // employee has nothing to do here; they read their own ratings off their
      // profile instead, so the tab stays hidden for them.
      {
        href: "/performance/review",
        label: "Monthly Review",
        icon: Star,
        show: (c) => c.isFinance || c.isLead,
      },
    ],
  },
  {
    label: "Finance",
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
    items: [
      {
        href: "/settings/scoring",
        label: "Scoring & Targets",
        icon: Settings2,
        show: (c) => c.isFinance,
      },
      { href: "/audit", label: "Audit Log", icon: ScrollText, show: (c) => c.isAdmin },
      {
        href: "/settings/device-mapping",
        label: "Device Mapping",
        icon: Fingerprint,
        show: (c) => c.isAdmin,
      },
    ],
  },
];

/** Flattened, role-filtered nav — used by the sidebar and to resolve the page title. */
export function visibleGroups(ctx: NavCtx): NavGroup[] {
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.show || i.show(ctx)),
  })).filter((g) => g.items.length > 0);
}
