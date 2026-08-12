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
  CalendarOff,
  ShieldCheck,
  FolderKanban,
  Activity,
  ArrowUpRight,
  AlertCircle,
  ClipboardCheck,
  Star,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/components/_lib/api";
import { cn } from "@/lib/utils";
import { AdminProgressPanel } from "@/components/home/admin-progress-panel";
import { EmployeeAvatar } from "@/components/employees/employee-avatar";
import { formatDate } from "@/lib/format-date";
import { useAttendanceStatus } from "@/components/_lib/use-attendance-status";

type Me = { email: string; role: string; employeeId: string | null };
type Notification = { id: string; readAt: string | null };
type TodayEvents = {
  birthdays: { employeeId: string; fullName: string }[];
  anniversaries: { employeeId: string; fullName: string }[];
  events: { employeeId: string | null; fullName: string | null; title: string }[];
};
type WorkItem = { id: string; status: "pending" | "wip" | "in_review" | "completed" };
type RequestRow = { id: string; status: string };
type Payslip = { id: string; periodMonth: number; periodYear: number; status: string };
type Announcement = { id: string; title: string; createdAt: string };
type AttendanceRow = {
  employeeId: string;
  fullName: string;
  photoUrl: string | null;
  status: "present" | "half_day" | "on_leave" | "absent" | "holiday" | "weekly_off";
  leaveType: string | null;
  clockIn: string | null;
  clockOut: string | null;
};
type AttendanceOverview = {
  counts: { total: number; present: number; halfDay: number; onLeave: number; absent: number; weeklyOff: number; late: number; pendingApproval: number };
  rows: AttendanceRow[];
};
type Meeting = { id: string; title: string; scheduledAt: string; invitees: unknown[] };
type DailySelection = { id: string };
type PublishedPick = {
  id: string;
  periodType: "weekly" | "monthly";
  employeeName: string;
  departmentName: string;
  publishedAt: string;
};

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
  const { clockedIn, openSession } = useAttendanceStatus();

  // Individual-contributor data.
  const [tasks, setTasks] = useState<WorkItem[] | null>(null);
  const [myRequests, setMyRequests] = useState<RequestRow[] | null>(null);
  const [points, setPoints] = useState<number | null>(null);
  const [latestPayslip, setLatestPayslip] = useState<Payslip | null>(null);
  const [plannedToday, setPlannedToday] = useState<number | null>(null);
  const [mySelectionsToday, setMySelectionsToday] = useState<number | null>(null);

  // Lead / finance shared: pending approvals in the viewer's scope.
  const [pendingApprovals, setPendingApprovals] = useState<number | null>(null);

  // Finance (Admin/HR) org-wide data.
  const [attendance, setAttendance] = useState<AttendanceOverview | null>(null);

  // Announcements (all roles) + audit trail (admin only).
  const [announcements, setAnnouncements] = useState<Announcement[] | null>(null);

  // Upcoming meetings (all roles — the endpoint self-scopes: Admin/HR see
  // every meeting, everyone else sees only ones they're invited to/created).
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);

  // Employee of the Week/Month banner (2026-08-07) — admin-published picks,
  // ~24h window server-side; dismissal is per pick-id in localStorage so it
  // doesn't nag again this browser once acknowledged.
  const [publishedPicks, setPublishedPicks] = useState<PublishedPick[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);

  // Tasks the viewer has to sign off before their points are credited
  // (Pillar 2). The endpoint self-scopes: leads see their own units, Admin/HR
  // see the whole company, everyone else gets an empty list.
  const [awaitingReview, setAwaitingReview] = useState<number | null>(null);

  // People this Lead/Admin still owes a monthly review for (Pillar 3). Same
  // self-scoping endpoint the /performance/review sheet reads.
  const [reviewsPending, setReviewsPending] = useState<number | null>(null);

  // WorkUnits count for admin snapshot.
  const [workUnits, setWorkUnits] = useState<{ id: string; status: string }[] | null>(null);

  useEffect(() => {
    // Fire each request independently; a forbidden/empty endpoint just leaves
    // its widget in the loading/zero state (every endpoint self-scopes by role).
    apiFetch<Me>("/auth/me").then((r) => {
      setMe(r.data);
      if (r.data?.employeeId) {
        apiFetch<{ balance: number }>(`/employees/${r.data.employeeId}/points`).then((p) => {
          if (p.data) setPoints(p.data.balance);
        });
        apiFetch<{ id: string }[]>(
          `/daily-selections/today?employee_id=${r.data.employeeId}`,
        ).then((s) => setMySelectionsToday(s.data?.length ?? 0));
      }
    });
    apiFetch<{ notifications: Notification[] }>("/notifications").then((r) => {
      if (r.data) setUnread(r.data.notifications.filter((n) => !n.readAt).length);
    });
    apiFetch<TodayEvents>("/events/today").then((r) => setEvents(r.data));
    apiFetch<Announcement[]>("/announcements").then((r) => setAnnouncements(r.data ?? []));
    apiFetch<Meeting[]>("/events/meetings").then((r) => setMeetings(r.data ?? []));
    apiFetch<PublishedPick[]>("/recognition/published").then((r) => setPublishedPicks(r.data ?? []));
    try {
      const raw = window.localStorage.getItem("dismissed-eom-picks");
      if (raw) setDismissed(JSON.parse(raw));
    } catch {
      // ignore — banner just won't remember dismissals this session
    }

    if (hasEmployee) {
      apiFetch<WorkItem[]>("/work-items/mine").then((r) => setTasks(r.data ?? []));
      apiFetch<RequestRow[]>("/requests").then((r) => setMyRequests(r.data ?? []));
      apiFetch<Payslip[]>("/payslips").then((r) => setLatestPayslip(r.data?.[0] ?? null));
    }

    if (isLead || isFinance) {
      apiFetch<RequestRow[]>("/requests?status=pending").then((r) =>
        setPendingApprovals(r.data?.length ?? 0),
      );
      apiFetch<{ id: string }[]>("/work-items/review-queue").then((r) =>
        setAwaitingReview(r.data?.length ?? 0),
      );
      apiFetch<{ summary: { pending: number } }>("/performance-reviews/queue").then((r) =>
        setReviewsPending(r.data?.summary.pending ?? 0),
      );
    }

    if (isLead && !isFinance) {
      apiFetch<DailySelection[]>("/daily-selections/today").then((r) =>
        setPlannedToday(r.data?.length ?? 0),
      );
    }

    if (isFinance) {
      apiFetch<AttendanceOverview>("/attendance/overview").then((r) => setAttendance(r.data));
      apiFetch<{ id: string; status: string }[]>("/work-units").then((r) => setWorkUnits(r.data ?? []));
    }
  }, [hasEmployee, isLead, isFinance, isAdmin]);

  const celebrations = [
    ...(events?.birthdays ?? []).map((b) => `🎉 ${b.fullName}'s birthday`),
    ...(events?.anniversaries ?? []).map((a) => `🎊 ${a.fullName}'s work anniversary`),
    ...(events?.events ?? []).map((e) => `📌 ${e.fullName ? `${e.fullName} — ` : ""}${e.title}`),
  ];

  function dismissPick(id: string) {
    const next = [...dismissed, id];
    setDismissed(next);
    try {
      window.localStorage.setItem("dismissed-eom-picks", JSON.stringify(next));
    } catch {
      // non-fatal — worst case it re-shows next reload
    }
  }
  const visiblePicks = publishedPicks.filter((p) => !dismissed.includes(p.id));

  const openTasks = tasks?.filter((t) => t.status !== "completed").length ?? null;
  // Biometric clock-in never goes through Planning, so device days can start
  // with zero tasks picked. Nudge once there's an open office session, tasks
  // to pick from, and nothing selected yet today.
  const activeTaskCount =
    tasks?.filter((t) => t.status !== "completed" && t.status !== "in_review").length ?? 0;
  const needsTaskPick =
    hasEmployee &&
    !isAdmin &&
    clockedIn &&
    openSession?.workLocation === "office" &&
    activeTaskCount > 0 &&
    mySelectionsToday === 0;
  const pendingMyRequests = myRequests?.filter((r) => r.status === "pending").length ?? null;
  const presentRows = attendance?.rows.filter((r) => r.status === "present" || r.status === "half_day") ?? [];
  const onLeaveRows = attendance?.rows.filter((r) => r.status === "on_leave") ?? [];
  const now = Date.now();
  const upcomingMeetings = (meetings ?? [])
    .filter((m) => new Date(m.scheduledAt).getTime() >= now)
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
    .slice(0, 5);

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

      {visiblePicks.length > 0 && (
        <Card className="border-amber-400/50 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="flex flex-col gap-2 py-4 text-sm">
            {visiblePicks.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  🏆{" "}
                  <strong>
                    {p.employeeName}
                  </strong>{" "}
                  is {p.periodType === "weekly" ? "Employee of the Week" : "Employee of the Month"} for{" "}
                  {p.departmentName}!
                </span>
                <button
                  type="button"
                  onClick={() => dismissPick(p.id)}
                  className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  Dismiss
                </button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Clock status — employees/leads/HR who clock in; not admin. */}
      {hasEmployee && !isAdmin && <ClockCard />}

      {needsTaskPick && (
        <Card className="border-amber-400/50 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm">
            <span>
              You&apos;re clocked in but haven&apos;t picked today&apos;s tasks yet — the
              biometric device doesn&apos;t ask for them.
            </span>
            <Link href="/planning" className="w-fit">
              <Button size="sm">Pick today&apos;s tasks</Button>
            </Link>
          </CardContent>
        </Card>
      )}

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
          {!isAdmin && (
            <StatTile
              icon={<Clock className="size-4" />}
              label="Pending requests"
              value={pendingMyRequests}
              href="/requests"
            />
          )}
          {!isAdmin && (
            <StatTile
              icon={<Bell className="size-4" />}
              label="Unread notifications"
              value={unread}
              href="/notifications"
            />
          )}
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

      {/* Attendance records — placed right at the top after daily overview for Admin/HR. */}
      {isFinance && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Today&apos;s attendance</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <RosterCard
              icon={<UserCheck className="size-4" />}
              title="Present today"
              count={attendance ? attendance.counts.present + attendance.counts.halfDay : null}
              rows={presentRows}
              subLabel={(r) =>
                r.clockOut
                  ? `${fmtClockTime(r.clockIn)} – ${fmtClockTime(r.clockOut)}`
                  : r.clockIn
                    ? `${fmtClockTime(r.clockIn)} – now`
                    : "—"
              }
              emptyLabel="No one clocked in yet."
              href="/attendance"
            />
            <RosterCard
              icon={<CalendarOff className="size-4" />}
              title="On leave today"
              count={attendance ? onLeaveRows.length : null}
              rows={onLeaveRows}
              subLabel={(r) => (r.leaveType === "leave_unpaid" ? "Unpaid" : "Paid")}
              emptyLabel="No one on leave today."
              href="/attendance"
            />
          </div>
        </section>
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
            <StatTile
              icon={<ClipboardCheck className="size-4" />}
              label="Tasks awaiting your review"
              value={awaitingReview}
              hint="Points are credited when you accept"
              href="/work/review"
            />
            <StatTile
              icon={<Star className="size-4" />}
              label="Monthly reviews left"
              value={reviewsPending}
              hint="Your read on this month, one rating each"
              href="/performance/review"
            />
          </div>
        </section>
      )}

      {/* Task progress — the changing, day-to-day view — comes next for admins. */}
      {isAdmin && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Task progress</h2>
          <AdminProgressPanel />
        </section>
      )}

      {/* Upcoming meetings — dynamic by nature, only shown when there's
          something coming up. Self-scoped by the API: Admin/HR see every
          meeting, everyone else only what they're invited to. */}
      {upcomingMeetings.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Upcoming meetings</h2>
          <Card>
            <CardContent className="flex flex-col divide-y py-2">
              {upcomingMeetings.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="flex items-center gap-2 truncate">
                    <CalendarClock className="size-4 shrink-0 text-muted-foreground" />
                    {m.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatMeetingWhen(m.scheduledAt)}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
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
                    {formatDate(a.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* Operations snapshot for admin (replaced bare audit trail card). */}
        {isAdmin ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Operations Snapshot</CardTitle>
              <Link href="/requests" className="text-xs text-primary hover:underline">
                Manage →
              </Link>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {/* Mini metric grid */}
              <div className="grid grid-cols-3 gap-2">
                <Link
                  href="/employees"
                  className="flex flex-col rounded-md border p-2.5 transition-colors hover:bg-accent/40"
                >
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Users className="size-3.5" />
                    Team
                  </span>
                  <span className="mt-1 text-lg font-bold">
                    {attendance ? attendance.counts.total : "—"}
                  </span>
                  <span className="text-[11px] text-muted-foreground">Active staff</span>
                </Link>

                <Link
                  href="/attendance"
                  className="flex flex-col rounded-md border p-2.5 transition-colors hover:bg-accent/40"
                >
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Activity className="size-3.5" />
                    Turnout
                  </span>
                  <span className="mt-1 text-lg font-bold">
                    {attendance && attendance.counts.total > 0
                      ? `${Math.round(((attendance.counts.present + attendance.counts.halfDay) / attendance.counts.total) * 100)}%`
                      : "—"}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {attendance ? `${attendance.counts.present + attendance.counts.halfDay} present` : "Today"}
                  </span>
                </Link>

                <Link
                  href="/work"
                  className="flex flex-col rounded-md border p-2.5 transition-colors hover:bg-accent/40"
                >
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <FolderKanban className="size-3.5" />
                    Projects
                  </span>
                  <span className="mt-1 text-lg font-bold">
                    {workUnits ? workUnits.filter((w) => w.status === "active").length : "—"}
                  </span>
                  <span className="text-[11px] text-muted-foreground">Active units</span>
                </Link>
              </div>

              {/* Pending Action Items Bar */}
              <div className="rounded-md bg-muted/50 p-2.5 text-xs">
                <div className="mb-1.5 flex items-center justify-between font-medium text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <AlertCircle className="size-3.5" />
                    Action required
                  </span>
                  {(pendingApprovals ?? 0) + (attendance?.counts.pendingApproval ?? 0) === 0 ? (
                    <Badge variant="outline" className="text-[10px] text-emerald-500">
                      All clear
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px]">
                      {(pendingApprovals ?? 0) + (attendance?.counts.pendingApproval ?? 0)} pending
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Link
                    href="/requests"
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded border px-2 py-1 transition-colors hover:border-primary/50",
                      (pendingApprovals ?? 0) > 0 ? "border-primary/40 bg-primary/5 font-medium" : "text-muted-foreground"
                    )}
                  >
                    <span>Requests:</span>
                    <strong className="text-foreground">{pendingApprovals ?? 0}</strong>
                  </Link>
                  <Link
                    href="/attendance?approval_status=pending"
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded border px-2 py-1 transition-colors hover:border-primary/50",
                      (attendance?.counts.pendingApproval ?? 0) > 0 ? "border-primary/40 bg-primary/5 font-medium" : "text-muted-foreground"
                    )}
                  >
                    <span>Attendance:</span>
                    <strong className="text-foreground">{attendance?.counts.pendingApproval ?? 0}</strong>
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>
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

function fmtClockTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatMeetingWhen(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (isToday) return `Today, ${time}`;
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow, ${time}`;
  return `${d.toLocaleDateString(undefined, { day: "2-digit", month: "short" })}, ${time}`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

type WeeklyOffStatus = {
  canClaimToday: boolean;
  offToday: boolean;
  usedThisWeek: boolean;
  move: { id: string; date: string } | null;
};

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s`;
}

/** Employee clock-status card: clocked in/out, live elapsed, total today +
 *  current session. Since 2026-08-11 a day is a list of sessions, so the two
 *  figures genuinely differ once someone has stepped out and come back — total
 *  is the sum of every session's worked time, never last-out minus first-in,
 *  so breaks are excluded. When the employee hasn't clocked in yet and is
 *  eligible, also shows a "Take Weekly Off" button that posts to
 *  /attendance/weekly-off. */
function ClockCard() {
  const { attendance: rec, sessions, openSession, clockedIn, clockedOut, loading, refresh } =
    useAttendanceStatus();
  const [now, setNow] = useState(() => Date.now());
  const [weeklyOff, setWeeklyOff] = useState<WeeklyOffStatus | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    apiFetch<WeeklyOffStatus>("/attendance/weekly-off").then((r) => {
      if (r.data) setWeeklyOff(r.data);
    });
  }, []);

  const ticking = clockedIn;

  // Only tick while actively clocked in.
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking]);

  // Light polling so a device badge-in (which lands via the biometric sync,
  // not this browser tab) shows up as "live" without a manual refresh — only
  // while the tab is actually visible, to avoid pointless background traffic.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  async function manualRefresh() {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }

  // Worked time = sum of sessions (open one running to `now`). The gaps
  // between sessions are breaks and are deliberately not counted.
  const sessionMs = (s: { clockIn: string; clockOut: string | null }) =>
    Math.max(0, (s.clockOut ? new Date(s.clockOut).getTime() : now) - new Date(s.clockIn).getTime());
  const totalMs = sessions.reduce((acc, s) => acc + sessionMs(s), 0);
  const currentMs = openSession ? sessionMs(openSession) : 0;

  async function claimWeeklyOff() {
    setClaiming(true);
    setClaimError(null);
    try {
      const res = await fetch("/api/v1/attendance/weekly-off", { method: "POST" });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      setWeeklyOff(json.data);
    } catch (e) {
      setClaimError(e instanceof Error ? e.message : "Failed to claim weekly off.");
    } finally {
      setClaiming(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="size-4" />
          Attendance
          <Badge variant={ticking ? "default" : "outline"}>
            {loading
              ? "…"
              : weeklyOff?.offToday
                ? "weekly off"
                : clockedOut
                  ? "clocked out"
                  : clockedIn
                    ? "clocked in"
                    : "not clocked in"}
          </Badge>
        </CardTitle>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          onClick={manualRefresh}
          disabled={refreshing}
          aria-label="Refresh attendance"
        >
          <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {loading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : weeklyOff?.offToday ? (
          <>
            <p className="text-muted-foreground">
              {weeklyOff.move
                ? "You've taken your weekly off today. Enjoy your day!"
                : "Today is your team's default weekly off day."}
            </p>
            {weeklyOff.move && (
              <p className="text-xs text-muted-foreground">
                To come in today, ask Admin/HR to revert your weekly off first.
              </p>
            )}
          </>
        ) : !clockedIn && !clockedOut ? (
          <>
            <p className="text-muted-foreground">
              You haven&apos;t clocked in today. In-office attendance is captured automatically by
              the biometric device — clock in here only if you&apos;re working from home.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link href="/planning" className="w-fit">
                <Button>Clock In WFH</Button>
              </Link>
              {weeklyOff?.canClaimToday && (
                <Button
                  variant="outline"
                  disabled={claiming}
                  onClick={claimWeeklyOff}
                >
                  {claiming ? "Claiming…" : "Take Weekly Off"}
                </Button>
              )}
            </div>
            {claimError && <p className="text-xs text-destructive">{claimError}</p>}
            {weeklyOff?.usedThisWeek && !weeklyOff.offToday && (
              <p className="text-xs text-muted-foreground">
                Weekly off already used this week (on {weeklyOff.move?.date ?? "another day"}).
              </p>
            )}
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground">
              {clockedOut
                ? `Clocked out at ${new Date(rec!.clockOutRaw!).toLocaleTimeString()}. You can clock back in any time.`
                : `Clocked in at ${new Date(openSession!.clockIn).toLocaleTimeString()}${
                    openSession!.workLocation === "wfh" ? " (from home)" : ""
                  }.`}
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-muted-foreground">Total today</div>
                <div className="text-2xl font-bold tabular-nums">{fmtDuration(totalMs)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Current session</div>
                <div className="text-2xl font-bold tabular-nums">
                  {clockedIn ? fmtDuration(currentMs) : "—"}
                </div>
              </div>
            </div>
            <Link href="/planning" className="w-fit">
              <Button variant="outline">{clockedIn ? "Clock Out" : "Clock Back In (WFH)"}</Button>
            </Link>
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

/** Compact stat header + a scrollable roster of who makes up that count
 *  (2026-08-08 dashboard redesign) — replaces a bare number tile with an
 *  actually useful "who" view, without needing a separate page visit. */
function RosterCard({
  icon,
  title,
  count,
  rows,
  subLabel,
  emptyLabel,
  href,
}: {
  icon: React.ReactNode;
  title: string;
  count: number | null;
  rows: AttendanceRow[];
  subLabel?: (r: AttendanceRow) => string;
  emptyLabel: string;
  href: string;
}) {
  return (
    <Card className="h-full">
      <CardContent className="flex flex-col gap-2 py-4">
        <Link href={href} className="flex items-center justify-between gap-2 hover:underline">
          <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            {icon}
            {title}
          </span>
          <span className="text-2xl font-bold">{count === null ? "—" : count}</span>
        </Link>
        {rows.length === 0 ? (
          emptyLabel && <p className="text-xs text-muted-foreground">{emptyLabel}</p>
        ) : (
          <ul className="flex max-h-40 flex-col divide-y overflow-y-auto">
            {rows.map((r) => (
              <li key={r.employeeId} className="flex items-center gap-2 py-1.5 text-sm">
                <EmployeeAvatar fullName={r.fullName} photoUrl={r.photoUrl} size="sm" />
                <span className="truncate">{r.fullName}</span>
                {subLabel && (
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{subLabel(r)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
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
