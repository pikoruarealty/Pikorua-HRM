"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/components/_lib/api";

type Me = { email: string; role: string; employeeId: string | null };
type Notification = { id: string; readAt: string | null };
type TodayEvents = {
  birthdays: { employeeId: string; fullName: string }[];
  anniversaries: { employeeId: string; fullName: string }[];
};

const QUICK_LINKS: { href: string; label: string; desc: string }[] = [
  { href: "/planning", label: "Daily Planning", desc: "Clock in, pick today's tasks, see your EOD." },
  { href: "/my-tasks", label: "My Tasks", desc: "Progress and complete your work items." },
  { href: "/requests", label: "Requests", desc: "Leave & reimbursement requests." },
  { href: "/attendance", label: "Attendance", desc: "Your clock-in/out history." },
  { href: "/recognition", label: "Recognition", desc: "Leaderboard & Employee of the Month." },
  { href: "/payslips", label: "Payslips", desc: "Your generated payslips." },
];

export function HomeScreen({
  isFinance,
  isLead,
  hasEmployee,
}: {
  isFinance: boolean;
  isLead: boolean;
  hasEmployee: boolean;
}) {
  const [me, setMe] = useState<Me | null>(null);
  const [unread, setUnread] = useState(0);
  const [events, setEvents] = useState<TodayEvents | null>(null);

  useEffect(() => {
    apiFetch<Me>("/auth/me").then((r) => setMe(r.data));
    apiFetch<{ notifications: Notification[] }>("/notifications").then((r) => {
      if (r.data) setUnread(r.data.notifications.filter((n) => !n.readAt).length);
    });
    apiFetch<TodayEvents>("/events/today").then((r) => setEvents(r.data));
  }, []);

  const celebrations = [
    ...(events?.birthdays ?? []).map((b) => `🎉 ${b.fullName}'s birthday`),
    ...(events?.anniversaries ?? []).map((a) => `🎊 ${a.fullName}'s work anniversary`),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Pikorua HRM</h1>
        <p className="text-sm text-muted-foreground">
          {me ? `Signed in as ${me.email} · ${me.role}` : "Loading…"}
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notifications</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <span className="text-2xl font-bold text-foreground">{unread}</span> unread ·{" "}
            <Link href="/notifications" className="underline">
              view all
            </Link>
          </CardContent>
        </Card>

        {(isFinance || isLead) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Work Units</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Manage projects, sub-units and tasks ·{" "}
              <Link href="/work" className="underline">
                open
              </Link>
            </CardContent>
          </Card>
        )}

        {isFinance && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Finance</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Generate payslips & configure payroll ·{" "}
              <Link href="/payslips" className="underline">
                payslips
              </Link>
            </CardContent>
          </Card>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Quick links</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {QUICK_LINKS.filter((l) => hasEmployee || l.href === "/recognition").map((l) => (
            <Link key={l.href} href={l.href}>
              <Card className="h-full transition-colors hover:border-primary/50">
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
