"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/components/_lib/api";

type Announcement = {
  id: string;
  title: string;
  body: string;
  scopeType: "team" | "all" | "specific_teams";
  teamIds: string[];
  createdAt: string;
};
type Team = { id: string; name: string };

export function AnnouncementsScreen({
  canPost,
  isFinance,
  isAdmin = false,
}: {
  canPost: boolean;
  isFinance: boolean;
  /** Admin only — delete override (audited server-side). */
  isAdmin?: boolean;
}) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [scopeType, setScopeType] = useState<"all" | "specific_teams">("all");
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  async function refresh() {
    const res = await apiFetch<Announcement[]>("/announcements");
    if (res.data) setAnnouncements(res.data);
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) =>
      prev.size === announcements.length ? new Set() : new Set(announcements.map((a) => a.id)),
    );
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} announcement${selected.size === 1 ? "" : "s"}?`)) return;
    setDeleting(true);
    setError(null);
    try {
      await Promise.all([...selected].map((id) => apiFetch(`/announcements/${id}`, { method: "DELETE" })));
      setSelected(new Set());
      refresh();
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    refresh();
    if (isFinance) apiFetch<Team[]>("/teams").then((r) => r.data && setTeams(r.data));
  }, [isFinance]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const payload: Record<string, unknown> = { title, body };
    if (isFinance) {
      payload.scopeType = scopeType;
      if (scopeType === "specific_teams") payload.teamIds = teamIds;
    }
    // Leads send no scopeType — the server forces it to "team" (their own team).
    const res = await apiFetch("/announcements", { method: "POST", body: JSON.stringify(payload) });
    if (res.error) {
      setError(`${res.error.code}: ${res.error.message}`);
      return;
    }
    setTitle("");
    setBody("");
    setTeamIds([]);
    refresh();
  }

  // Admin-only escape hatch: remove a stale/mistaken announcement.
  async function remove(id: string, title: string) {
    if (!confirm(`Delete the announcement "${title}"?`)) return;
    setError(null);
    const res = await apiFetch(`/announcements/${id}`, { method: "DELETE" });
    if (res.error) {
      setError(`${res.error.code}: ${res.error.message}`);
      return;
    }
    refresh();
  }

  function toggleTeam(id: string) {
    setTeamIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Announcements</h1>
        <p className="text-sm text-muted-foreground">
          {isFinance
            ? "Post company-wide or to specific teams."
            : canPost
              ? "As a Lead, your posts go to your own team."
              : "Announcements visible to you."}
        </p>
      </div>

      {canPost && (
        <Card>
          <CardHeader>
            <CardTitle>Post announcement</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
              </div>
              {isFinance && (
                <div className="flex flex-col gap-1.5">
                  <Label>Scope</Label>
                  <Select
                    value={scopeType}
                    onValueChange={(v) => setScopeType(v as "all" | "specific_teams")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Everyone</SelectItem>
                      <SelectItem value="specific_teams">Specific teams</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label>Body</Label>
                <Textarea value={body} onChange={(e) => setBody(e.target.value)} required />
              </div>
              {isFinance && scopeType === "specific_teams" && (
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <Label>Teams</Label>
                  <div className="flex flex-wrap gap-2">
                    {teams.map((t) => (
                      <button
                        type="button"
                        key={t.id}
                        onClick={() => toggleTeam(t.id)}
                        className={`rounded border px-2 py-1 text-xs ${
                          teamIds.includes(t.id) ? "border-primary bg-primary/10" : "border-input"
                        }`}
                      >
                        {t.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
              <Button type="submit" className="w-fit sm:col-span-2">
                Post
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Announcements</CardTitle>
          {isAdmin && announcements.length > 0 && (
            <div className="flex items-center gap-3">
              {selected.size > 0 && (
                <Button size="sm" variant="destructive" disabled={deleting} onClick={deleteSelected}>
                  {deleting ? "Deleting…" : `Delete (${selected.size})`}
                </Button>
              )}
              <label className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                <input
                  type="checkbox"
                  checked={selected.size === announcements.length}
                  onChange={toggleSelectAll}
                  className="size-3.5"
                />
                Select all
              </label>
            </div>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {announcements.length === 0 && <p className="text-sm text-muted-foreground">None visible.</p>}
          {announcements.map((a) => (
            <div key={a.id} className="flex gap-3 rounded border p-3 text-sm">
              {isAdmin && (
                <input
                  type="checkbox"
                  checked={selected.has(a.id)}
                  onChange={() => toggleSelected(a.id)}
                  className="mt-1 size-3.5 shrink-0"
                  aria-label={`Select announcement: ${a.title}`}
                />
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{a.title}</span>
                    <Badge variant="outline">{a.scopeType}</Badge>
                  </span>
                  {isAdmin && (
                    <Button size="sm" variant="destructive" onClick={() => remove(a.id, a.title)}>
                      Delete
                    </Button>
                  )}
                </div>
                <p className="text-muted-foreground">{a.body}</p>
                <span className="text-xs text-muted-foreground">
                  {new Date(a.createdAt).toLocaleString()}
                </span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
