"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { apiFetch } from "../_lib/api";

type TodayEvents = {
  birthdays: { employeeId: string; fullName: string }[];
  anniversaries: { employeeId: string; fullName: string }[];
};
type Invitee = { id: string; employeeId: string | null; teamId: string | null };
type Meeting = {
  id: string;
  title: string | null;
  scheduledAt: string | null;
  reminderLeadMinutes: number | null;
  createdById: string | null;
  invitees: Invitee[];
};
type Employee = { id: string; fullName: string; role: string };
type Team = { id: string; name: string };

// Cron jobs (birthday-check, meeting-reminders) are CRON_SECRET-gated, not
// session-gated — deliberately not triggerable from this browser UI (the
// secret is server-only and must not reach client JS). Trigger them with
// curl: POST /api/v1/cron/<job> with `Authorization: Bearer <CRON_SECRET>`.
export default function EventsPage() {
  const [today, setToday] = useState<TodayEvents | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [me, setMe] = useState<{ id: string; role: string } | null>(null);

  const [title, setTitle] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [reminderLeadMinutes, setReminderLeadMinutes] = useState("15");
  const [inviteeEmployeeIds, setInviteeEmployeeIds] = useState<string[]>([]);
  const [inviteeTeamIds, setInviteeTeamIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const canCreate = me && ["admin", "hr", "tech_lead", "sales_lead"].includes(me.role);

  async function refreshToday() {
    const res = await apiFetch<TodayEvents>("/events/today");
    if (res.data) setToday(res.data);
  }
  async function refreshMeetings() {
    const res = await apiFetch<Meeting[]>("/events/meetings");
    if (res.data) setMeetings(res.data);
  }

  useEffect(() => {
    refreshToday();
    refreshMeetings();
    fetch("/api/test/employees").then((r) => r.json()).then((json) => {
      if (json.data) setEmployees(json.data);
    });
    fetch("/api/test/teams").then((r) => r.json()).then((json) => {
      if (json.data) setTeams(json.data);
    });
    apiFetch<{ id: string; role: string }>("/auth/me").then((res) => {
      if (res.data) setMe({ id: res.data.id, role: res.data.role });
    });
  }, []);

  function toggle(list: string[], set: (v: string[]) => void, id: string) {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  async function createMeeting(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await apiFetch("/events/meetings", {
      method: "POST",
      body: JSON.stringify({
        title,
        scheduledAt: new Date(scheduledAt).toISOString(),
        reminderLeadMinutes: Number(reminderLeadMinutes),
        inviteeEmployeeIds: inviteeEmployeeIds.length ? inviteeEmployeeIds : undefined,
        inviteeTeamIds: inviteeTeamIds.length ? inviteeTeamIds : undefined,
      }),
    });
    if (res.error) {
      setError(`${res.error.code}: ${res.error.message}`);
      return;
    }
    setTitle("");
    setScheduledAt("");
    setInviteeEmployeeIds([]);
    setInviteeTeamIds([]);
    refreshMeetings();
  }

  async function deleteMeeting(id: string) {
    setActionError(null);
    const res = await apiFetch(`/events/meetings/${id}`, { method: "DELETE" });
    if (res.error) setActionError(`${res.error.code}: ${res.error.message}`);
    refreshMeetings();
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Today&apos;s banner (GET /events/today)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {today && today.birthdays.length === 0 && today.anniversaries.length === 0 && (
            <p className="text-muted-foreground">No birthdays or anniversaries today.</p>
          )}
          {today?.birthdays.map((b) => <p key={b.employeeId}>🎉 {b.fullName}&apos;s birthday today!</p>)}
          {today?.anniversaries.map((a) => <p key={a.employeeId}>🎊 {a.fullName}&apos;s work anniversary today!</p>)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Create meeting (POST /events/meetings)</CardTitle>
        </CardHeader>
        <CardContent>
          {!canCreate && (
            <p className="mb-3 text-sm text-muted-foreground">
              Your role ({me?.role ?? "…"}) cannot create meetings — Admin/HR/Lead only. Submitting below will 403.
            </p>
          )}
          <form onSubmit={createMeeting} className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Scheduled at</Label>
              <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Reminder lead (minutes)</Label>
              <Input type="number" value={reminderLeadMinutes} onChange={(e) => setReminderLeadMinutes(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label>Invitees — individuals</Label>
              <div className="flex flex-wrap gap-2">
                {employees.map((emp) => (
                  <button
                    type="button"
                    key={emp.id}
                    onClick={() => toggle(inviteeEmployeeIds, setInviteeEmployeeIds, emp.id)}
                    className={`rounded border px-2 py-1 text-xs ${inviteeEmployeeIds.includes(emp.id) ? "border-primary bg-primary/10" : "border-input"}`}
                  >
                    {emp.fullName}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label>Invitees — whole teams</Label>
              <div className="flex flex-wrap gap-2">
                {teams.map((t) => (
                  <button
                    type="button"
                    key={t.id}
                    onClick={() => toggle(inviteeTeamIds, setInviteeTeamIds, t.id)}
                    className={`rounded border px-2 py-1 text-xs ${inviteeTeamIds.includes(t.id) ? "border-primary bg-primary/10" : "border-input"}`}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
            {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
            <Button type="submit" className="w-fit sm:col-span-2">Create</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Meetings visible to you (GET /events/meetings)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {actionError && <p className="text-sm text-destructive">{actionError}</p>}
          {meetings.length === 0 && <p className="text-sm text-muted-foreground">None visible.</p>}
          {meetings.map((m) => {
            const canManage = me && (me.role === "admin" || me.role === "hr" || m.createdById === me.id);
            return (
              <div key={m.id} className="flex items-center justify-between rounded border p-3 text-sm">
                <div>
                  <p className="font-medium">{m.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.scheduledAt && new Date(m.scheduledAt).toLocaleString()} · reminder {m.reminderLeadMinutes}min before · {m.invitees.length} invitee row(s)
                  </p>
                </div>
                {canManage && (
                  <Button size="sm" variant="destructive" onClick={() => deleteMeeting(m.id)}>Delete</Button>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
