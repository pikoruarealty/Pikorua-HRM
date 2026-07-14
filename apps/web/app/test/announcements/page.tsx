"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "../_lib/api";

type Announcement = {
  id: string;
  title: string;
  body: string;
  scopeType: "team" | "all" | "specific_teams";
  teamIds: string[];
  createdAt: string;
};
type Team = { id: string; name: string };

export default function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [scopeType, setScopeType] = useState<"all" | "specific_teams">("all");
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const isLead = role === "tech_lead" || role === "sales_lead";
  const isFinance = role === "admin" || role === "hr";

  async function refresh() {
    const res = await apiFetch<Announcement[]>("/announcements");
    if (res.data) setAnnouncements(res.data);
  }

  useEffect(() => {
    refresh();
    fetch("/api/test/teams").then((r) => r.json()).then((json) => {
      if (json.data) setTeams(json.data);
    });
    apiFetch<{ role: string }>("/auth/me").then((res) => {
      if (res.data) setRole(res.data.role);
    });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const body_: Record<string, unknown> = { title, body };
    if (isFinance) {
      body_.scopeType = scopeType;
      if (scopeType === "specific_teams") body_.teamIds = teamIds;
    }
    // Leads send no scopeType at all — the server forces it to "team" either way.
    const res = await apiFetch("/announcements", { method: "POST", body: JSON.stringify(body_) });
    if (res.error) {
      setError(`${res.error.code}: ${res.error.message}`);
      return;
    }
    setTitle("");
    setBody("");
    setTeamIds([]);
    refresh();
  }

  function toggleTeam(id: string) {
    setTeamIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Post announcement (POST /announcements)</CardTitle>
        </CardHeader>
        <CardContent>
          {!isLead && !isFinance && (
            <p className="mb-3 text-sm text-muted-foreground">
              Your role ({role ?? "…"}) cannot post announcements — Lead or Admin/HR only. Submitting below will 403.
            </p>
          )}
          {isLead && (
            <p className="mb-3 text-sm text-muted-foreground">
              You&apos;re a Lead — scope_type is always forced to &quot;team&quot; (your own led team) server-side, whatever you send.
            </p>
          )}
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Body</Label>
              <Input value={body} onChange={(e) => setBody(e.target.value)} required />
            </div>
            {isFinance && (
              <div className="flex flex-col gap-1.5">
                <Label>Scope</Label>
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={scopeType}
                  onChange={(e) => setScopeType(e.target.value as "all" | "specific_teams")}
                >
                  <option value="all">all</option>
                  <option value="specific_teams">specific_teams</option>
                </select>
              </div>
            )}
            {isFinance && scopeType === "specific_teams" && (
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label>Teams</Label>
                <div className="flex flex-wrap gap-2">
                  {teams.map((t) => (
                    <button
                      type="button"
                      key={t.id}
                      onClick={() => toggleTeam(t.id)}
                      className={`rounded border px-2 py-1 text-xs ${teamIds.includes(t.id) ? "border-primary bg-primary/10" : "border-input"}`}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
            <Button type="submit" className="w-fit sm:col-span-2">Post</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Announcements visible to you (GET /announcements)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {announcements.length === 0 && <p className="text-sm text-muted-foreground">None visible.</p>}
          {announcements.map((a) => (
            <div key={a.id} className="flex flex-col gap-1 rounded border p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{a.title}</span>
                <Badge variant="outline">{a.scopeType}</Badge>
              </div>
              <p className="text-muted-foreground">{a.body}</p>
              <span className="text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
