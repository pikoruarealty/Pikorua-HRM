"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmployeeAvatar } from "@/components/employees/employee-avatar";

type Team = {
  id: string;
  name: string;
  department: { id: string; name: string };
  teamLeadId: string | null;
  teamLead: { id: string; fullName: string } | null;
  expectedStartTime: string | null;
};

type Member = {
  id: string;
  fullName: string;
  photoUrl: string | null;
  email: string;
  role: string;
  status: "active" | "inactive";
};

async function getJson(res: Response) {
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data;
}

function humanizeRole(role: string) {
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function TeamDetail({ teamId, canManage }: { teamId: string; canManage: boolean }) {
  const router = useRouter();
  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [teamData, memberData] = await Promise.all([
        getJson(await fetch(`/api/v1/teams/${teamId}`)),
        getJson(await fetch(`/api/v1/employees?team_id=${teamId}`)),
      ]);
      setTeam(teamData);
      setMembers(memberData);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load team.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error && !team) return <p className="text-sm text-destructive">{error}</p>;
  if (!team) return null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/teams" className="text-sm text-muted-foreground hover:underline">
          ← Teams
        </Link>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{team.name}</h1>
          <p className="text-sm text-muted-foreground">{team.department.name}</p>
        </div>
        {canManage && (
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            Edit
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <span className="text-muted-foreground">Team lead: </span>
            {team.teamLead?.fullName ?? "— unassigned —"}
          </div>
          <div>
            <span className="text-muted-foreground">Expected start: </span>
            {team.expectedStartTime ?? "— not set —"}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {members.length} member{members.length === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">No employees assigned to this team.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow
                    key={m.id}
                    onClick={() => router.push(`/employees/${m.id}`)}
                    className="cursor-pointer hover:bg-muted/50"
                  >
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <EmployeeAvatar fullName={m.fullName} photoUrl={m.photoUrl} size="sm" />
                        {m.fullName}
                      </span>
                    </TableCell>
                    <TableCell>{m.email}</TableCell>
                    <TableCell>{humanizeRole(m.role)}</TableCell>
                    <TableCell>{m.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit &quot;{team.name}&quot;</DialogTitle>
            </DialogHeader>
            <EditTeamForm
              team={team}
              onSaved={() => {
                setEditOpen(false);
                load();
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function EditTeamForm({ team, onSaved }: { team: Team; onSaved: () => void }) {
  const [name, setName] = useState(team.name);
  const [teamLeadId, setTeamLeadId] = useState(team.teamLeadId ?? "");
  const [expectedStartTime, setExpectedStartTime] = useState(team.expectedStartTime ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await getJson(
        await fetch(`/api/v1/teams/${team.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            ...(teamLeadId ? { team_lead_id: teamLeadId } : {}),
            expected_start_time: expectedStartTime || null,
          }),
        }),
      );
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update team.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="edit_name">Name</Label>
        <Input id="edit_name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="edit_lead">Team lead employee ID</Label>
        <Input id="edit_lead" value={teamLeadId} onChange={(e) => setTeamLeadId(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="edit_expected_start_time">Expected start (HH:MM)</Label>
        <Input
          id="edit_expected_start_time"
          type="time"
          value={expectedStartTime}
          onChange={(e) => setExpectedStartTime(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={submitting}>
        {submitting ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
