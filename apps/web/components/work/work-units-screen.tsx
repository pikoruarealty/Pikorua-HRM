"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { apiFetch } from "@/components/_lib/api";

type WorkUnit = {
  id: string;
  name: string;
  status: string;
  departmentId: string;
  progress?: { completed: number; total: number };
};
type Department = { id: string; name: string };
type Employee = { id: string; fullName: string; role: string };

export function WorkUnitsScreen() {
  const [workUnits, setWorkUnits] = useState<WorkUnit[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [teamLeadId, setTeamLeadId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    const res = await apiFetch<WorkUnit[]>("/work-units");
    if (res.data) setWorkUnits(res.data);
  }

  useEffect(() => {
    refresh();
    apiFetch<Department[]>("/departments").then((r) => r.data && setDepartments(r.data));
    apiFetch<Employee[]>("/employees").then((r) => r.data && setEmployees(r.data));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await apiFetch("/work-units", {
      method: "POST",
      body: JSON.stringify({
        name,
        description: description || undefined,
        departmentId,
        teamLeadId: teamLeadId || undefined,
      }),
    });
    setLoading(false);
    if (res.error) {
      setError(`${res.error.code}: ${res.error.message}`);
      return;
    }
    setName("");
    setDescription("");
    setTeamLeadId("");
    refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Work Units</h1>
        <p className="text-sm text-muted-foreground">
          Projects / Campaigns — the top of the work hierarchy. Click one to manage its sub-units,
          tasks and AI task generation.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New work unit</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Department</Label>
              <Select value={departmentId || undefined} onValueChange={setDepartmentId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a department…" />
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
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label>Description (optional, feeds AI task generation)</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this project/campaign about? The more detail, the better the AI breakdown."
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label>Team Lead (optional, Leads default to self)</Label>
              <Select
                value={teamLeadId || "__self__"}
                onValueChange={(v) => setTeamLeadId(v === "__self__" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__self__">(default to self)</SelectItem>
                  {employees.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {emp.fullName} ({emp.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
            <Button type="submit" disabled={loading} className="w-fit sm:col-span-2">
              {loading ? "Creating…" : "Create"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your work units</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {workUnits.length === 0 && (
            <p className="text-sm text-muted-foreground">None visible to your role yet.</p>
          )}
          {workUnits.map((wu) => {
            const total = wu.progress?.total ?? 0;
            const completed = wu.progress?.completed ?? 0;
            const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
            return (
              <Link
                key={wu.id}
                href={`/work/${wu.id}`}
                className="flex flex-col gap-2 rounded border p-3 text-sm hover:bg-muted/50"
              >
                <span className="flex items-center justify-between">
                  <span className="font-medium">{wu.name}</span>
                  <Badge variant="outline">{wu.status}</Badge>
                </span>
                {wu.progress && (
                  <span className="flex items-center gap-2">
                    <Progress value={percent} className="max-w-xs" />
                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                      {completed}/{total} done
                    </span>
                  </span>
                )}
              </Link>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
