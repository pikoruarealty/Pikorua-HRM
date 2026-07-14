"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "../../_lib/api";

type WorkItem = {
  id: string;
  title: string;
  mode: "atomic" | "metric";
  status: string;
  taskPoints?: number | null;
  targetValue?: string | null;
  currentValue?: string | null;
  periodMonth?: number | null;
  periodYear?: number | null;
  assignedTo: string;
};

type SubUnit = { id: string; name: string; workItems: WorkItem[] };
type WorkUnitDetail = { id: string; name: string; status: string; subUnits: SubUnit[] };

function NewSubUnitForm({ workUnitId, onCreated }: { workUnitId: string; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await apiFetch(`/work-units/${workUnitId}/sub-units`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    if (res.error) {
      setError(`${res.error.code}: ${res.error.message}`);
      return;
    }
    setName("");
    onCreated();
  }

  return (
    <form onSubmit={submit} className="flex items-end gap-2">
      <div className="flex flex-col gap-1.5">
        <Label>New SubUnit name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <Button type="submit" size="sm">Add SubUnit</Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}

type Employee = { id: string; fullName: string; role: string; teamId: string | null };
type Team = { id: string; name: string; teamLeadId: string | null };

function NewWorkItemForm({ subUnitId, onCreated }: { subUnitId: string; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [mode, setMode] = useState<"atomic" | "metric">("atomic");
  const [taskPoints, setTaskPoints] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [periodMonth, setPeriodMonth] = useState(String(new Date().getMonth() + 1));
  const [periodYear, setPeriodYear] = useState(String(new Date().getFullYear()));
  const [error, setError] = useState<string | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [me, setMe] = useState<{ role: string; employeeId: string | null } | null>(null);

  useEffect(() => {
    fetch("/api/test/employees").then((r) => r.json()).then((json) => {
      if (json.data) setEmployees(json.data);
    });
    fetch("/api/test/teams").then((r) => r.json()).then((json) => {
      if (json.data) setTeams(json.data);
    });
    apiFetch<{ role: string; employee: { id: string } | null }>("/auth/me").then((res) => {
      if (res.data) setMe({ role: res.data.role, employeeId: res.data.employee?.id ?? null });
    });
  }, []);

  const isLead = me?.role === "tech_lead" || me?.role === "sales_lead";
  const ownTeam = isLead && me?.employeeId ? teams.find((t) => t.teamLeadId === me.employeeId) ?? null : null;
  // Leads only see their own team's members here — the server enforces this
  // too (POST /sub-units/:id/work-items rejects cross-team assignedTo for
  // Leads), this just keeps the dropdown from offering choices that would 400.
  const assignableEmployees = isLead ? employees.filter((emp) => emp.teamId === ownTeam?.id) : employees;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const body: Record<string, unknown> = { title, assignedTo, mode };
    if (mode === "atomic") body.taskPoints = Number(taskPoints);
    else {
      body.targetValue = Number(targetValue);
      body.periodMonth = Number(periodMonth);
      body.periodYear = Number(periodYear);
    }
    const res = await apiFetch(`/sub-units/${subUnitId}/work-items`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (res.error) {
      setError(`${res.error.code}: ${res.error.message}`);
      return;
    }
    setTitle("");
    onCreated();
  }

  return (
    <form onSubmit={submit} className="grid gap-2 sm:grid-cols-2 rounded border p-3">
      <div className="flex flex-col gap-1.5">
        <Label>Title</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Assigned employee</Label>
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={assignedTo}
          onChange={(e) => setAssignedTo(e.target.value)}
          required
        >
          <option value="">Select an employee…</option>
          {assignableEmployees.map((emp) => (
            <option key={emp.id} value={emp.id}>{emp.fullName} ({emp.role})</option>
          ))}
        </select>
        {isLead && !ownTeam && (
          <p className="text-xs text-destructive">No team found where you&apos;re the lead — assignment will fail server-side.</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Mode</Label>
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={mode}
          onChange={(e) => setMode(e.target.value as "atomic" | "metric")}
        >
          <option value="atomic">atomic</option>
          <option value="metric">metric</option>
        </select>
      </div>
      {mode === "atomic" ? (
        <div className="flex flex-col gap-1.5">
          <Label>Task points</Label>
          <Input type="number" value={taskPoints} onChange={(e) => setTaskPoints(e.target.value)} required />
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <Label>Target value</Label>
            <Input type="number" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Period month</Label>
            <Input type="number" value={periodMonth} onChange={(e) => setPeriodMonth(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Period year</Label>
            <Input type="number" value={periodYear} onChange={(e) => setPeriodYear(e.target.value)} required />
          </div>
        </>
      )}
      {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
      <Button type="submit" size="sm" className="w-fit sm:col-span-2">Add WorkItem</Button>
    </form>
  );
}

export default function WorkUnitDetailPage() {
  const params = useParams<{ id: string }>();
  const [workUnit, setWorkUnit] = useState<WorkUnitDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await apiFetch<WorkUnitDetail>(`/work-units/${params.id}`);
    if (res.data) setWorkUnit(res.data);
    if (res.error) setError(`${res.error.code}: ${res.error.message}`);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!workUnit) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">{workUnit.name}</h1>
        <Badge variant="outline">{workUnit.status}</Badge>
      </div>

      <NewSubUnitForm workUnitId={workUnit.id} onCreated={refresh} />

      {(workUnit.subUnits ?? []).map((su) => (
        <Card key={su.id}>
          <CardHeader>
            <CardTitle className="text-base">{su.name}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {(su.workItems ?? []).map((wi) => (
              <div key={wi.id} className="flex items-center justify-between rounded border p-2 text-sm">
                <span>
                  {wi.title} <span className="text-muted-foreground">({wi.mode})</span>
                  {wi.mode === "metric" && (
                    <span className="text-muted-foreground"> — {wi.currentValue}/{wi.targetValue} for {wi.periodMonth}/{wi.periodYear}</span>
                  )}
                </span>
                <Badge variant="outline">{wi.status}</Badge>
              </div>
            ))}
            <NewWorkItemForm subUnitId={su.id} onCreated={refresh} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
