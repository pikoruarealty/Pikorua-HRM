"use client";

import { useCallback, useEffect, useState } from "react";
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
  assignee?: { id: string; fullName: string } | null;
};
type SubUnit = { id: string; name: string; workItems: WorkItem[] };
type WorkUnitDetail = {
  id: string;
  name: string;
  status: string;
  description?: string | null;
  departmentId: string;
  teamLeadId?: string | null;
  subUnits: SubUnit[];
};
type Member = { id: string; fullName: string; role: string };

type DraftWorkItem = { title: string; taskPoints?: number; targetValue?: number };
type DraftSubUnit = { name: string; workItems: DraftWorkItem[] };
type GenerateResult = {
  mode: "atomic" | "metric";
  labels?: { subUnit: string };
  subUnits: DraftSubUnit[];
};

/** Two-step AI planning: draft the expected outcome, approve it, generate the
 *  task tree, assign each task to a team member, then persist. */
function PlanTasksPanel({
  workUnit,
  members,
  onPersisted,
}: {
  workUnit: WorkUnitDetail;
  members: Member[];
  onPersisted: () => void;
}) {
  const [description, setDescription] = useState(workUnit.description ?? "");
  const [outcome, setOutcome] = useState<string | null>(null);
  const [draft, setDraft] = useState<GenerateResult | null>(null);
  // Per-task assignee, keyed "subUnitIndex-itemIndex".
  const [assignees, setAssignees] = useState<Record<string, string>>({});
  const [assignAll, setAssignAll] = useState("");
  const [loading, setLoading] = useState<"outcome" | "tasks" | "assign" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const key = (si: number, wi: number) => `${si}-${wi}`;

  async function draftOutcome(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDraft(null);
    setLoading("outcome");
    const res = await apiFetch<{ expectedOutcome: string }>(`/work-units/${workUnit.id}/generate-tasks`, {
      method: "POST",
      body: JSON.stringify({ stage: "outcome", description: description || undefined }),
    });
    setLoading(null);
    if (res.error) return setError(`${res.error.code}: ${res.error.message}`);
    setOutcome(res.data?.expectedOutcome ?? "");
  }

  async function generateTasks() {
    if (!outcome?.trim()) return setError("Draft and confirm the expected outcome first.");
    setError(null);
    setLoading("tasks");
    const res = await apiFetch<GenerateResult>(`/work-units/${workUnit.id}/generate-tasks`, {
      method: "POST",
      body: JSON.stringify({ stage: "tasks", description: description || undefined, expectedOutcome: outcome }),
    });
    setLoading(null);
    if (res.error) return setError(`${res.error.code}: ${res.error.message}`);
    setDraft(res.data);
    setAssignees({});
    setAssignAll("");
  }

  function setAssignAllTo(memberId: string) {
    setAssignAll(memberId);
    if (!draft) return;
    const next: Record<string, string> = {};
    draft.subUnits.forEach((su, si) => su.workItems.forEach((_, wi) => (next[key(si, wi)] = memberId)));
    setAssignees(next);
  }

  const allAssigned =
    draft?.subUnits.every((su, si) => su.workItems.every((_, wi) => assignees[key(si, wi)])) ?? false;
  const totalItems = draft?.subUnits.reduce((n, su) => n + su.workItems.length, 0) ?? 0;

  async function assign() {
    if (!draft) return;
    if (!allAssigned) return setError("Assign every task to a team member before assigning.");
    setError(null);
    setLoading("assign");
    const payload = {
      persist: true,
      subUnits: draft.subUnits.map((su, si) => ({
        name: su.name,
        workItems: su.workItems.map((wi, wj) => ({
          title: wi.title,
          ...(draft.mode === "atomic"
            ? { taskPoints: wi.taskPoints }
            : { targetValue: wi.targetValue }),
          assignedTo: assignees[key(si, wj)],
        })),
      })),
    };
    const res = await apiFetch(`/work-units/${workUnit.id}/generate-tasks`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setLoading(null);
    if (res.error) return setError(`${res.error.code}: ${res.error.message}`);
    setDraft(null);
    setOutcome(null);
    onPersisted();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plan tasks with AI</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form onSubmit={draftOutcome} className="flex flex-col gap-2">
          <Label>Project description (falls back to the saved description)</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the project/campaign so the AI can plan the expected outcome and tasks…"
          />
          <Button type="submit" size="sm" className="w-fit" disabled={loading !== null}>
            {loading === "outcome" ? "Drafting…" : outcome !== null ? "Re-draft outcome" : "1. Draft expected outcome"}
          </Button>
        </form>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {outcome !== null && (
          <div className="flex flex-col gap-2 rounded border p-3">
            <Label>Expected outcome — review &amp; edit, then confirm</Label>
            <Textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} rows={5} />
            <Button
              type="button"
              size="sm"
              className="w-fit"
              onClick={generateTasks}
              disabled={loading !== null || !outcome.trim()}
            >
              {loading === "tasks" ? "Generating…" : "2. Generate tasks from this outcome"}
            </Button>
          </div>
        )}

        {draft && (
          <div className="flex flex-col gap-3 rounded border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                Mode: <Badge variant="outline">{draft.mode}</Badge> — {draft.subUnits.length}{" "}
                {draft.labels?.subUnit ?? "sub-unit"}(s), {totalItems} task(s). Nothing saved yet.
              </p>
              <div className="flex items-center gap-2">
                <Label className="text-xs">Assign all to</Label>
                <Select value={assignAll || undefined} onValueChange={setAssignAllTo}>
                  <SelectTrigger className="h-8 w-48">
                    <SelectValue placeholder="team member…" />
                  </SelectTrigger>
                  <SelectContent>
                    {members.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.fullName} ({m.role})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {draft.subUnits.map((su, si) => (
              <div key={si} className="rounded border p-2">
                <p className="text-sm font-medium">{su.name}</p>
                <div className="mt-1 flex flex-col gap-1.5">
                  {su.workItems.map((wi, wj) => (
                    <div key={wj} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 flex-1">
                        {wi.title}
                        <span className="text-muted-foreground">
                          {draft.mode === "atomic"
                            ? ` — ${wi.taskPoints ?? "?"} pts`
                            : ` · target ${wi.targetValue ?? "?"}`}
                        </span>
                      </span>
                      <Select
                        value={assignees[key(si, wj)] || undefined}
                        onValueChange={(v) => setAssignees((a) => ({ ...a, [key(si, wj)]: v }))}
                      >
                        <SelectTrigger className="h-8 w-48">
                          <SelectValue placeholder="assign to…" />
                        </SelectTrigger>
                        <SelectContent>
                          {members.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.fullName} ({m.role})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <Button
              type="button"
              size="sm"
              className="w-fit"
              onClick={assign}
              disabled={loading !== null || !allAssigned}
            >
              {loading === "assign" ? "Assigning…" : "3. Assign"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CollapsibleForm({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setOpen((o) => !o)}>
        {open ? "− Close" : `+ ${label}`}
      </Button>
      {open && children}
    </div>
  );
}

function ReassignControl({
  workItemId,
  members,
  currentId,
  onReassigned,
}: {
  workItemId: string;
  members: Member[];
  currentId?: string | null;
  onReassigned: () => void;
}) {
  const [busy, setBusy] = useState(false);
  async function reassign(assignedTo: string) {
    setBusy(true);
    await apiFetch(`/work-items/${workItemId}`, {
      method: "PATCH",
      body: JSON.stringify({ assignedTo }),
    });
    setBusy(false);
    onReassigned();
  }
  return (
    <Select value={currentId || undefined} onValueChange={reassign} disabled={busy}>
      <SelectTrigger className="h-8 w-44">
        <SelectValue placeholder="reassign…" />
      </SelectTrigger>
      <SelectContent>
        {members.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.fullName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
    if (res.error) return setError(`${res.error.code}: ${res.error.message}`);
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
  members,
  onCreated,
}: {
  subUnitId: string;
  members: Member[];
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
    if (res.error) return setError(`${res.error.code}: ${res.error.message}`);
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
            <SelectValue placeholder="Select a team member…" />
          </SelectTrigger>
          <SelectContent>
            {members.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.fullName} ({m.role})
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

/** Assign a fixed set of work items to one member in a single batch (used by the
 *  bulk-select bar and the per-feature "assign all"). Reuses the validated
 *  PATCH /work-items/:id route per item. */
function AssignAllControl({
  members,
  busy,
  onAssign,
  label,
  widthClass = "w-52",
}: {
  members: Member[];
  busy: boolean;
  onAssign: (memberId: string) => void;
  label: string;
  widthClass?: string;
}) {
  return (
    <Select value={undefined} onValueChange={onAssign} disabled={busy}>
      <SelectTrigger className={`h-8 ${widthClass}`}>
        <SelectValue placeholder={busy ? "Assigning…" : label} />
      </SelectTrigger>
      <SelectContent>
        {members.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.fullName} ({m.role})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function WorkUnitDetailScreen({
  workUnitId,
  isFinance,
  isLead,
  employeeId,
}: {
  workUnitId: string;
  isFinance: boolean;
  isLead: boolean;
  employeeId: string | null;
}) {
  const [workUnit, setWorkUnit] = useState<WorkUnitDetail | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Bulk-assign selection: a set of WorkItem ids checked across the whole unit.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const refresh = useCallback(async () => {
    const res = await apiFetch<WorkUnitDetail>(`/work-units/${workUnitId}`);
    if (res.data) setWorkUnit(res.data);
    if (res.error) setError(`${res.error.code}: ${res.error.message}`);
  }, [workUnitId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Assign every id in `ids` to `memberId`, then refresh once. Errors surface
  // in the shared error line; partial success is fine (each PATCH is independent).
  const assignMany = useCallback(
    async (ids: string[], memberId: string) => {
      if (ids.length === 0 || !memberId) return;
      setBulkBusy(true);
      setError(null);
      const results = await Promise.all(
        ids.map((id) =>
          apiFetch(`/work-items/${id}`, { method: "PATCH", body: JSON.stringify({ assignedTo: memberId }) }),
        ),
      );
      const failed = results.filter((r) => r.error);
      if (failed.length > 0) {
        setError(`${failed.length} of ${ids.length} could not be assigned: ${failed[0].error?.message}`);
      }
      setBulkBusy(false);
      setSelected(new Set());
      refresh();
    },
    [refresh],
  );

  const canManage =
    workUnit != null && (isFinance || (isLead && employeeId != null && employeeId === workUnit.teamLeadId));

  // The assignable-members endpoint is Admin/HR/owning-lead only; fetch once we
  // know the caller can manage this unit.
  useEffect(() => {
    if (!canManage) return;
    apiFetch<Member[]>(`/work-units/${workUnitId}/assignable-members`).then((r) => r.data && setMembers(r.data));
  }, [canManage, workUnitId]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!workUnit) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const allItems = (workUnit.subUnits ?? []).flatMap((su) => su.workItems ?? []);
  const completedCount = allItems.filter((wi) => wi.status === "completed").length;
  const progressPercent = allItems.length > 0 ? Math.round((completedCount / allItems.length) * 100) : 0;

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
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{workUnit.description}</p>
        )}
        {allItems.length > 0 && (
          <div className="mt-3 flex max-w-sm items-center gap-2">
            <Progress value={progressPercent} />
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {completedCount}/{allItems.length} done
            </span>
          </div>
        )}
      </div>

      {canManage && <PlanTasksPanel workUnit={workUnit} members={members} onPersisted={refresh} />}

      {/* Bulk-assign bar — appears once one or more tasks are ticked. */}
      {canManage && selected.size > 0 && (
        <div className="sticky top-16 z-10 flex flex-wrap items-center gap-3 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <AssignAllControl
            members={members}
            busy={bulkBusy}
            onAssign={(memberId) => assignMany([...selected], memberId)}
            label="Assign selected to…"
          />
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} disabled={bulkBusy}>
            Clear
          </Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Sub-units &amp; work items</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {canManage && (
            <CollapsibleForm label="Add sub-unit">
              <NewSubUnitForm workUnitId={workUnit.id} onCreated={refresh} />
            </CollapsibleForm>
          )}
          {(workUnit.subUnits ?? []).map((su) => {
            const suItemIds = (su.workItems ?? []).map((wi) => wi.id);
            const allSuSelected = suItemIds.length > 0 && suItemIds.every((id) => selected.has(id));
            return (
            <div key={su.id} className="flex flex-col gap-3 rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {canManage && suItemIds.length > 0 && (
                    <input
                      type="checkbox"
                      aria-label={`Select all tasks in ${su.name}`}
                      checked={allSuSelected}
                      onChange={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (allSuSelected) suItemIds.forEach((id) => next.delete(id));
                          else suItemIds.forEach((id) => next.add(id));
                          return next;
                        })
                      }
                    />
                  )}
                  <p className="font-medium">{su.name}</p>
                </div>
                {canManage && suItemIds.length > 0 && (
                  <AssignAllControl
                    members={members}
                    busy={bulkBusy}
                    onAssign={(memberId) => assignMany(suItemIds, memberId)}
                    label="Assign whole feature to…"
                    widthClass="w-56"
                  />
                )}
              </div>
              {(su.workItems ?? []).map((wi) => (
                <div
                  key={wi.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    {canManage && (
                      <input
                        type="checkbox"
                        aria-label={`Select ${wi.title}`}
                        checked={selected.has(wi.id)}
                        onChange={() => toggleSelect(wi.id)}
                      />
                    )}
                    <span className="min-w-0 flex-1">
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
                      {wi.assignee && (
                        <span className="text-muted-foreground"> · assigned to {wi.assignee.fullName}</span>
                      )}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge variant="outline">{wi.status}</Badge>
                    {canManage && (
                      <ReassignControl
                        workItemId={wi.id}
                        members={members}
                        currentId={wi.assignee?.id}
                        onReassigned={refresh}
                      />
                    )}
                  </span>
                </div>
              ))}
              {canManage && (
                <CollapsibleForm label="Add task">
                  <NewWorkItemForm subUnitId={su.id} members={members} onCreated={refresh} />
                </CollapsibleForm>
              )}
            </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
