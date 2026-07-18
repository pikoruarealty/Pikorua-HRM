"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckSquare,
  Bell,
  Clock,
  Award,
  Inbox,
  Users,
  UserCheck,
  CalendarClock,
  FileText,
  ShieldCheck,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/components/_lib/api";
import { cn } from "@/lib/utils";

type Me = { email: string; role: string; employeeId: string | null };
type Notification = { id: string; readAt: string | null };
type TodayEvents = {
  birthdays: { employeeId: string; fullName: string }[];
  anniversaries: { employeeId: string; fullName: string }[];
};
type WorkItem = { id: string; status: "pending" | "wip" | "completed" };
type RequestRow = { id: string; status: string };
type Employee = { id: string; status: "active" | "inactive" };
type Payslip = { id: string; periodMonth: number; periodYear: number; status: string };
type Announcement = { id: string; title: string; createdAt: string };
type AttendanceOverview = {
  counts: { total: number; present: number; halfDay: number; onLeave: number; absent: number; late: number; pendingApproval: number };
};
type DailySelection = { id: string };
type AuditLog = { id: string; action: string; actor: { email: string } | null; createdAt: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function humanizeRole(role: string) {
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const QUICK_LINKS: { href: string; label: string; desc: string }[] = [
  { href: "/planning", label: "Daily Planning", desc: "Clock in, pick today's tasks, see your EOD." },
  { href: "/my-tasks", label: "My Tasks", desc: "Progress and complete your work items." },
  { href: "/requests", label: "Requests", desc: "Leave & reimbursement requests." },
  { href: "/attendance", label: "Attendance", desc: "Your clock-in/out history." },
  { href: "/recognition", label: "Recognition", desc: "Leaderboard & Employee of the Month." },
  { href: "/payslips", label: "Payslips", desc: "Your generated payslips." },
];

export function HomeScreen({
  role,
  isFinance,
  isAdmin,
  isLead,
  hasEmployee,
}: {
  role: string;
  isFinance: boolean;
  isAdmin: boolean;
  isLead: boolean;
  hasEmployee: boolean;
}) {
  const [me, setMe] = useState<Me | null>(null);
  const [unread, setUnread] = useState(0);
  const [events, setEvents] = useState<TodayEvents | null>(null);

  // Individual-contributor data.
  const [tasks, setTasks] = useState<WorkItem[] | null>(null);
  const [myRequests, setMyRequests] = useState<RequestRow[] | null>(null);
  const [points, setPoints] = useState<number | null>(null);
  const [latestPayslip, setLatestPayslip] = useState<Payslip | null>(null);
  const [plannedToday, setPlannedToday] = useState<number | null>(null);

  // Lead / finance shared: pending approvals in the viewer's scope.
  const [pendingApprovals, setPendingApprovals] = useState<number | null>(null);

  // Finance (Admin/HR) org-wide data.
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [attendance, setAttendance] = useState<AttendanceOverview | null>(null);
  const [draftPayslips, setDraftPayslips] = useState<number | null>(null);

  // Announcements (all roles) + audit trail (admin only).
  const [announcements, setAnnouncements] = useState<Announcement[] | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[] | null>(null);

  useEffect(() => {
    // Fire each request independently; a forbidden/empty endpoint just leaves
    // its widget in the loading/zero state (every endpoint self-scopes by role).
    apiFetch<Me>("/auth/me").then((r) => {
      setMe(r.data);
      if (r.data?.employeeId) {
        apiFetch<{ balance: number }>(`/employees/${r.data.employeeId}/points`).then((p) => {
          if (p.data) setPoints(p.data.balance);
        });
      }
    });
    apiFetch<{ notifications: Notification[] }>("/notifications").then((r) => {
      if (r.data) setUnread(r.data.notifications.filter((n) => !n.readAt).length);
    });
    apiFetch<TodayEvents>("/events/today").then((r) => setEvents(r.data));
    apiFetch<Announcement[]>("/announcements").then((r) => setAnnouncements(r.data ?? []));

    if (hasEmployee) {
      apiFetch<WorkItem[]>("/work-items/mine").then((r) => setTasks(r.data ?? []));
      apiFetch<RequestRow[]>("/requests").then((r) => setMyRequests(r.data ?? []));
      apiFetch<Payslip[]>("/payslips").then((r) => setLatestPayslip(r.data?.[0] ?? null));
    }

    if (isLead || isFinance) {
      apiFetch<RequestRow[]>("/requests?status=pending").then((r) =>
        setPendingApprovals(r.data?.length ?? 0),
      );
    }

    if (isLead && !isFinance) {
      apiFetch<DailySelection[]>("/daily-selections/today").then((r) =>
        setPlannedToday(r.data?.length ?? 0),
      );
    }

    if (isFinance) {
      apiFetch<Employee[]>("/employees").then((r) => setEmployees(r.data ?? []));
      apiFetch<AttendanceOverview>("/attendance/overview").then((r) => setAttendance(r.data));
      apiFetch<Payslip[]>("/payslips").then((r) =>
        setDraftPayslips(r.data?.filter((p) => p.status === "draft").length ?? 0),
      );
    }

    if (isAdmin) {
      apiFetch<{ logs: AuditLog[] }>("/audit-logs?limit=5").then((r) =>
        setAuditLogs(r.data?.logs ?? []),
      );
    }
  }, [hasEmployee, isLead, isFinance, isAdmin]);

  const celebrations = [
    ...(events?.birthdays ?? []).map((b) => `🎉 ${b.fullName}'s birthday`),
    ...(events?.anniversaries ?? []).map((a) => `🎊 ${a.fullName}'s work anniversary`),
  ];

  const openTasks = tasks?.filter((t) => t.status !== "completed").length ?? null;
  const pendingMyRequests = myRequests?.filter((r) => r.status === "pending").length ?? null;
  const activeHeadcount = employees?.filter((e) => e.status === "active").length ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {greeting()}
          {me?.email ? `, ${me.email.split("@")[0]}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground">
          {me ? `Signed in as ${me.email} · ${humanizeRole(role)}` : "Loading…"}
        </p>
      </div>

      {celebrations.length > 0 && (
        <Card className="border-primary/40">
          <CardContent className="flex flex-wrap items-center gap-3 py-4 text-sm">
            <span className="font-medium">Today:</span>
            {celebrations.map((c, i) => (
              <Badge key={i} variant="secondary">
                {c}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Clock status — employees/leads/HR who clock in; not admin. */}
      {hasEmployee && !isAdmin && <ClockCard />}

      {/* Personal stat tiles — shown to anyone with an employee record. */}
      {hasEmployee && (
        <div className={cn("grid gap-4 sm:grid-cols-2", isAdmin ? "lg:grid-cols-2" : "lg:grid-cols-4")}>
          {!isAdmin && (
            <StatTile
              icon={<CheckSquare className="size-4" />}
              label="Open tasks"
              value={openTasks}
              href="/my-tasks"
            />
          )}
          <StatTile
            icon={<Clock className="size-4" />}
            label="Pending requests"
            value={pendingMyRequests}
            href="/requests"
          />
          <StatTile
            icon={<Bell className="size-4" />}
            label="Unread notifications"
            value={unread}
            href="/notifications"
          />
          {!isAdmin && (
            <StatTile
              icon={<Award className="size-4" />}
              label="Recognition points"
              value={points}
              href="/recognition"
            />
          )}
        </div>
      )}

      {/* Lead tiles — team-scoped oversight (no salary/finance data). */}
      {isLead && !isFinance && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Your team</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatTile
              icon={<Inbox className="size-4" />}
              label="Requests awaiting action"
              value={pendingApprovals}
              href="/requests"
            />
            <StatTile
              icon={<CalendarClock className="size-4" />}
              label="Planned today"
              value={plannedToday}
              href="/planning"
            />
            <StatTile
              icon={<Users className="size-4" />}
              label="Work units"
              value={null}
              hint="Manage projects & tasks"
              href="/work"
            />
          </div>
        </section>
      )}

      {/* Admin/HR org-wide tiles. */}
      {isFinance && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Company at a glance</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              icon={<Users className="size-4" />}
              label="Active headcount"
              value={activeHeadcount}
              href="/employees"
            />
            <StatTile
              icon={<UserCheck className="size-4" />}
              label="Present today"
              value={attendance ? attendance.counts.present + attendance.counts.halfDay : null}
              hint={attendance ? `${attendance.counts.absent} absent · ${attendance.counts.onLeave} on leave` : undefined}
              href="/attendance"
            />
            <StatTile
              icon={<Inbox className="size-4" />}
              label="Pending approvals"
              value={pendingApprovals}
              hint={attendance ? `${attendance.counts.pendingApproval} attendance to review` : undefined}
              href="/requests"
            />
            <StatTile
              icon={<FileText className="size-4" />}
              label="Draft payslips"
              value={draftPayslips}
              href="/payslips"
            />
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Latest announcements — everyone. */}
        <Panel title="Announcements" href="/announcements" linkLabel="All">
          {announcements === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : announcements.length === 0 ? (
            <p className="text-sm text-muted-foreground">No announcements yet.</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {announcements.slice(0, 4).map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="truncate">{a.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(a.createdAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* Latest payslip for the individual; audit trail for admins. */}
        {isAdmin ? (
          <Panel title="Recent activity" href="/audit" linkLabel="Audit log">
            {auditLogs === null ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : auditLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No audited activity yet.</p>
            ) : (
              <ul className="flex flex-col divide-y">
                {auditLogs.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="flex items-center gap-2 truncate">
                      <ShieldCheck className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate font-mono text-xs">{l.action}</span>
                      {l.actor && (
                        <span className="truncate text-xs text-muted-foreground">
                          {l.actor.email}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {new Date(l.createdAt).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : (
          hasEmployee && (
            <Panel title="Latest payslip" href="/payslips" linkLabel="All payslips">
              {latestPayslip === null ? (
                <p className="text-sm text-muted-foreground">No payslips available yet.</p>
              ) : (
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">
                    {MONTHS[latestPayslip.periodMonth - 1]} {latestPayslip.periodYear}
                  </span>
                  <Badge variant={latestPayslip.status === "finalized" ? "default" : "secondary"}>
                    {latestPayslip.status}
                  </Badge>
                </div>
              )}
            </Panel>
          )
        )}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Quick links</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {QUICK_LINKS.filter((l) => (hasEmployee || l.href === "/recognition") && !(isAdmin && l.href === "/my-tasks")).map((l) => (
            <Link key={l.href} href={l.href}>
              <Card className="h-full hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md active:translate-y-0">
                <CardHeader>
                  <CardTitle className="text-base">{l.label}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">{l.desc}</CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

type TodayAttendance = { date: string; clockInRaw: string | null; clockOutRaw: string | null };

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s`;
}

/** Employee clock-status card: clocked in/out, live elapsed, total today +
 *  current session (equal until breaks land — the split is wired now). */
function ClockCard() {
  const [rec, setRec] = useState<TodayAttendance | null | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    apiFetch<TodayAttendance[]>("/attendance").then((r) => {
      const today = new Date().toISOString().slice(0, 10);
      setRec((r.data ?? []).find((a) => a.date.slice(0, 10) === today) ?? null);
    });
  }, []);

  const clockedIn = !!rec?.clockInRaw;
  const clockedOut = !!rec?.clockOutRaw;
  const ticking = clockedIn && !clockedOut;

  // Only tick while actively clocked in.
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking]);

  const elapsedMs =
    rec?.clockInRaw != null
      ? (rec.clockOutRaw ? new Date(rec.clockOutRaw).getTime() : now) -
        new Date(rec.clockInRaw).getTime()
      : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="size-4" />
          Attendance
          <Badge variant={ticking ? "default" : "outline"}>
            {rec === undefined
              ? "…"
              : clockedOut
                ? "clocked out"
                : clockedIn
                  ? "clocked in"
                  : "not clocked in"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {rec === undefined ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : !clockedIn ? (
          <>
            <p className="text-muted-foreground">You haven&apos;t clocked in today.</p>
            <Link href="/planning" className="w-fit">
              <Button>Clock In</Button>
            </Link>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground">
              {clockedOut
                ? `Clocked out at ${new Date(rec.clockOutRaw!).toLocaleTimeString()}.`
                : `Clocked in at ${new Date(rec.clockInRaw!).toLocaleTimeString()}.`}
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-muted-foreground">Total today</div>
                <div className="text-2xl font-bold tabular-nums">{fmtDuration(elapsedMs)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Current session</div>
                <div className="text-2xl font-bold tabular-nums">
                  {clockedOut ? "—" : fmtDuration(elapsedMs)}
                </div>
              </div>
            </div>
            {!clockedOut && (
              <Link href="/planning" className="w-fit">
                <Button variant="outline">Clock Out</Button>
              </Link>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Compact metric tile. `value === null` renders a dash (loading / N/A). */
function StatTile({
  icon,
  label,
  value,
  hint,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null;
  hint?: string;
  href: string;
}) {
  return (
    <Link href={href}>
      <Card className="h-full hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md active:translate-y-0">
        <CardContent className="flex flex-col gap-1 py-4">
          <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            {icon}
            {label}
          </span>
          <span className="text-2xl font-bold">{value === null ? "—" : value}</span>
          {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        </CardContent>
      </Card>
    </Link>
  );
}

function Panel({
  title,
  href,
  linkLabel,
  children,
}: {
  title: string;
  href: string;
  linkLabel: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{title}</CardTitle>
        <Link href={href} className="text-xs text-primary hover:underline">
          {linkLabel}
        </Link>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
