"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

type Team = {
  id: string;
  name: string;
  departmentId: string;
  department: { id: string; name: string; typeKey: string };
  teamLeadId: string | null;
  teamLead: { id: string; fullName: string } | null;
  expectedStartTime: string | null;
};

type Department = { id: string; name: string; typeKey: string };

async function getJson(res: Response) {
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data;
}

export function TeamsScreen({ canManage }: { canManage: boolean }) {
  const router = useRouter();
  const [teams, setTeams] = useState<Team[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [teamsData, deptData] = await Promise.all([
        getJson(await fetch("/api/v1/teams")),
        canManage ? getJson(await fetch("/api/v1/departments")) : Promise.resolve([]),
      ]);
      setTeams(teamsData);
      setDepartments(deptData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load teams.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onDelete(team: Team) {
    if (!window.confirm(`Delete team "${team.name}"? This cannot be undone.`)) {
      return;
    }
    setDeletingId(team.id);
    setError(null);
    try {
      await getJson(await fetch(`/api/v1/teams/${team.id}`, { method: "DELETE" }));
      if (editingId === team.id) setEditingId(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete team.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Teams</h1>
        <p className="text-sm text-muted-foreground">
          {canManage
            ? "Create and manage teams across all departments."
            : "Teams in your department."}
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {canManage && <CreateTeamForm departments={departments} onCreated={load} />}

      <Card>
        <CardHeader>
          <CardTitle>All teams</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Team lead</TableHead>
                  <TableHead>Expected start</TableHead>
                  {canManage && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {teams.map((t) => (
                  <TableRow
                    key={t.id}
                    onClick={() => router.push(`/teams/${t.id}`)}
                    className="cursor-pointer hover:bg-muted/50"
                  >
                    <TableCell>{t.name}</TableCell>
                    <TableCell>{t.department.name}</TableCell>
                    <TableCell>{t.teamLead?.fullName ?? "— unassigned —"}</TableCell>
                    <TableCell>{t.expectedStartTime ?? "— not set —"}</TableCell>
                    {canManage && (
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingId(t.id);
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={deletingId === t.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              onDelete(t);
                            }}
                          >
                            {deletingId === t.id ? "Deleting…" : "Delete"}
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <Dialog open={editingId !== null} onOpenChange={(open) => !open && setEditingId(null)}>
          <DialogContent>
            {editingId && (
              <>
                <DialogHeader>
                  <DialogTitle>
                    Edit &quot;{teams.find((t) => t.id === editingId)!.name}&quot;
                  </DialogTitle>
                </DialogHeader>
                <EditTeamForm
                  team={teams.find((t) => t.id === editingId)!}
                  onSaved={() => {
                    setEditingId(null);
                    load();
                  }}
                />
              </>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function CreateTeamForm({
  departments,
  onCreated,
}: {
  departments: Department[];
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [teamLeadId, setTeamLeadId] = useState("");
  const [expectedStartTime, setExpectedStartTime] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await getJson(
        await fetch("/api/v1/teams", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            department_id: departmentId,
            team_lead_id: teamLeadId,
            expected_start_time: expectedStartTime || null,
          }),
        }),
      );
      setName("");
      setDepartmentId("");
      setTeamLeadId("");
      setExpectedStartTime("");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create team.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New team</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="team_name">Name</Label>
            <Input id="team_name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="department_id">Department</Label>
            <Select value={departmentId || undefined} onValueChange={setDepartmentId}>
              <SelectTrigger id="department_id" className="w-56">
                <SelectValue placeholder="Select department" />
              </SelectTrigger>
              <SelectContent>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="team_lead_id">Team lead employee ID</Label>
            <Input
              id="team_lead_id"
              placeholder="employee UUID with a lead role"
              value={teamLeadId}
              onChange={(e) => setTeamLeadId(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="expected_start_time">Expected start (HH:MM)</Label>
            <Input
              id="expected_start_time"
              type="time"
              value={expectedStartTime}
              onChange={(e) => setExpectedStartTime(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create team"}
          </Button>
        </form>
      </CardContent>
    </Card>
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
