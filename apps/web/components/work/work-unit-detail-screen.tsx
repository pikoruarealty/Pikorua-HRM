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
import { apiFetch } from "@/components/_lib/api";

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
};
type SubUnit = { id: string; name: string; workItems: WorkItem[] };
type WorkUnitDetail = {
  id: string;
  name: string;
  status: string;
  description?: string | null;
  departmentId: string;
  subUnits: SubUnit[];
};
// `/employees` is already role-scoped server-side (Leads get their own team),
// so the assignment dropdown needs no client-side team filtering.
type Employee = { id: string; fullName: string; role: string };

type DraftWorkItem = { title: string; taskPoints?: number; targetValue?: number };
type DraftSubUnit = { name: string; workItems: DraftWorkItem[] };
type GenerateResult = {
  mode: "atomic" | "metric";
  labels?: { subUnit: string };
  subUnits: DraftSubUnit[];
};

function GenerateTasksPanel({
  workUnit,
  employees,
  onPersisted,
}: {
  workUnit: WorkUnitDetail;
  employees: Employee[];
  onPersisted: () => void;
}) {
  const [description, setDescription] = useState(workUnit.description ?? "");
  const [draft, setDraft] = useState<GenerateResult | null>(null);
  const [defaultAssigneeId, setDefaultAssigneeId] = useState("");
  const [loading, setLoading] = useState<"draft" | "persist" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDraft(null);
    setLoading("draft");
    const res = await apiFetch<GenerateResult>(`/work-units/${workUnit.id}/generate-tasks`, {
      method: "POST",
      body: JSON.stringify({ description: description || undefined }),
    });
    setLoading(null);
    if (res.error) {
      setError(`${res.error.code}: ${res.error.message}`);
      return;
    }
    setDraft(res.data);
  }

  async function handlePersist() {
    if (!defaultAssigneeId) {
      setError("Pick a default assignee before persisting.");
      return;
    }
    setError(null);
    setLoading("persist");
    const res = await apiFetch(`/work-units/${workUnit.id}/generate-tasks`, {
      method: "POST",
      body: JSON.stringify({ description: description || undefined, persist: true, defaultAssigneeId }),
    });
    setLoading(null);
    if (res.error) {
      setError(`${res.error.code}: ${res.error.message}`);
      return;
    }
    setDraft(null);
    onPersisted();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Generate tasks with AI</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form onSubmit={handleGenerate} className="flex flex-col gap-2">
          <Label>Project description (falls back to the saved description)</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the project/campaign so the LLM can break it into sub-units and tasks…"
          />
          <Button type="submit" size="sm" className="w-fit" disabled={loading !== null}>
            {loading === "draft" ? "Generating…" : "Preview draft"}
          </Button>
        </form>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {draft && (
          <div className="flex flex-col gap-3 rounded border p-3">
            <p className="text-sm text-muted-foreground">
              Mode: <Badge variant="outline">{draft.mode}</Badge> — {draft.subUnits.length}{" "}
              {draft.labels?.subUnit ?? "sub-unit"}(s) proposed. Nothing has been saved yet.
            </p>
            {draft.subUnits.map((su, i) => (
              <div key={i} className="rounded border p-2">
                <p className="text-sm font-medium">{su.name}</p>
                <ul className="ml-4 list-disc text-sm text-muted-foreground">
                  {su.workItems.map((wi, j) => (
                    <li key={j}>
                      {wi.title}
                      {draft.mode === "atomic"
                        ? ` — ${wi.taskPoints ?? "?"} pts`
                        : ` · target ${wi.targetValue ?? "?"}`}
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <div className="flex items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <Label>Assign every generated WorkItem to</Label>
                <Select
                  value={defaultAssigneeId || undefined}
                  onValueChange={setDefaultAssigneeId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select an employee…" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((emp) => (
                      <SelectItem key={emp.id} value={emp.id}>
                        {emp.fullName} ({emp.role})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" size="sm" onClick={handlePersist} disabled={loading !== null}>
                {loading === "persist" ? "Saving…" : "Persist to DB"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

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
        <Label>New sub-unit name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <Button type="submit" size="sm">
        Add sub-unit
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}

function NewWorkItemForm({
  subUnitId,
  employees,
  onCreated,
}: {
  subUnitId: string;
  employees: Employee[];
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [mode, setMode] = useState<"atomic" | "metric">("atomic");
  const [taskPoints, setTaskPoints] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [periodMonth, setPeriodMonth] = useState(String(new Date().getMonth() + 1));
  const [periodYear, setPeriodYear] = useState(String(new Date().getFullYear()));
  const [error, setError] = useState<string | null>(null);

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
    <form onSubmit={submit} className="grid gap-2 rounded border p-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <Label>Title</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Assigned employee</Label>
        <Select value={assignedTo || undefined} onValueChange={setAssignedTo}>
          <SelectTrigger>
            <SelectValue placeholder="Select an employee…" />
          </SelectTrigger>
          <SelectContent>
            {employees.map((emp) => (
              <SelectItem key={emp.id} value={emp.id}>
                {emp.fullName} ({emp.role})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Mode</Label>
        <Select value={mode} onValueChange={(v) => setMode(v as "atomic" | "metric")}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="atomic">Atomic</SelectItem>
            <SelectItem value="metric">Metric</SelectItem>
          </SelectContent>
        </Select>
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
      <Button type="submit" size="sm" className="w-fit sm:col-span-2">
        Add work item
      </Button>
    </form>
  );
}

export function WorkUnitDetailScreen({ workUnitId }: { workUnitId: string }) {
  const [workUnit, setWorkUnit] = useState<WorkUnitDetail | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await apiFetch<WorkUnitDetail>(`/work-units/${workUnitId}`);
    if (res.data) setWorkUnit(res.data);
    if (res.error) setError(`${res.error.code}: ${res.error.message}`);
  }

  useEffect(() => {
    refresh();
    apiFetch<Employee[]>("/employees").then((r) => r.data && setEmployees(r.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workUnitId]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!workUnit) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/work" className="text-sm text-muted-foreground hover:underline">
          ← Work units
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{workUnit.name}</h1>
          <Badge variant="outline">{workUnit.status}</Badge>
        </div>
        {workUnit.description && (
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
            {workUnit.description}
          </p>
        )}
      </div>

      <GenerateTasksPanel workUnit={workUnit} employees={employees} onPersisted={refresh} />

      <Card>
        <CardHeader>
          <CardTitle>Sub-units &amp; work items</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <NewSubUnitForm workUnitId={workUnit.id} onCreated={refresh} />
          {(workUnit.subUnits ?? []).map((su) => (
            <div key={su.id} className="flex flex-col gap-3 rounded-lg border p-3">
              <p className="font-medium">{su.name}</p>
              {(su.workItems ?? []).map((wi) => (
                <div
                  key={wi.id}
                  className="flex items-center justify-between rounded border p-2 text-sm"
                >
                  <span>
                    {wi.title} <span className="text-muted-foreground">({wi.mode})</span>
                    {wi.mode === "metric" && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {wi.currentValue}/{wi.targetValue} for {wi.periodMonth}/{wi.periodYear}
                      </span>
                    )}
                    {wi.mode === "atomic" && (
                      <span className="text-muted-foreground"> · {wi.taskPoints} pts</span>
                    )}
                  </span>
                  <Badge variant="outline">{wi.status}</Badge>
                </div>
              ))}
              <NewWorkItemForm subUnitId={su.id} employees={employees} onCreated={refresh} />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
