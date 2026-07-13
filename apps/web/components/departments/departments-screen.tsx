"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type DepartmentLabels = {
  workUnitLabel: string;
  subUnitLabel: string;
  workItemLabel: string;
  workItemMode: "atomic" | "metric";
};

type Department = {
  id: string;
  name: string;
  typeKey: string;
  labels: DepartmentLabels | null;
};

async function getJson(res: Response) {
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data;
}

export function DepartmentsScreen() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingTypeKey, setEditingTypeKey] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await getJson(await fetch("/api/v1/departments"));
      setDepartments(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load departments.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Departments</h1>
        <p className="text-sm text-muted-foreground">
          Manage departments and the terminology each one uses for its work tree.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <CreateDepartmentForm onCreated={load} />

      <Card>
        <CardHeader>
          <CardTitle>All departments</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type key</TableHead>
                  <TableHead>Work unit</TableHead>
                  <TableHead>Sub unit</TableHead>
                  <TableHead>Work item</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {departments.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{d.name}</TableCell>
                    <TableCell>{d.typeKey}</TableCell>
                    <TableCell>{d.labels?.workUnitLabel ?? "—"}</TableCell>
                    <TableCell>{d.labels?.subUnitLabel ?? "—"}</TableCell>
                    <TableCell>{d.labels?.workItemLabel ?? "—"}</TableCell>
                    <TableCell>{d.labels?.workItemMode ?? "—"}</TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setEditingTypeKey(
                            editingTypeKey === d.typeKey ? null : d.typeKey,
                          )
                        }
                      >
                        {editingTypeKey === d.typeKey ? "Close" : "Edit labels"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {editingTypeKey && (
        <LabelEditor
          typeKey={editingTypeKey}
          initial={departments.find((d) => d.typeKey === editingTypeKey)?.labels ?? null}
          onSaved={() => {
            setEditingTypeKey(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function CreateDepartmentForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [typeKey, setTypeKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await getJson(
        await fetch("/api/v1/departments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, type_key: typeKey }),
        }),
      );
      setName("");
      setTypeKey("");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create department.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New department</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="type_key">Type key</Label>
            <Input
              id="type_key"
              placeholder="e.g. tech"
              value={typeKey}
              onChange={(e) => setTypeKey(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create department"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function LabelEditor({
  typeKey,
  initial,
  onSaved,
}: {
  typeKey: string;
  initial: DepartmentLabels | null;
  onSaved: () => void;
}) {
  const [workUnitLabel, setWorkUnitLabel] = useState(initial?.workUnitLabel ?? "");
  const [subUnitLabel, setSubUnitLabel] = useState(initial?.subUnitLabel ?? "");
  const [workItemLabel, setWorkItemLabel] = useState(initial?.workItemLabel ?? "");
  const [workItemMode, setWorkItemMode] = useState<"atomic" | "metric">(
    initial?.workItemMode ?? "atomic",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await getJson(
        await fetch(`/api/v1/departments/${typeKey}/labels`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            work_unit_label: workUnitLabel,
            sub_unit_label: subUnitLabel,
            work_item_label: workItemLabel,
            work_item_mode: workItemMode,
          }),
        }),
      );
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save labels.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Labels for &quot;{typeKey}&quot;</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="work_unit_label">Work unit label</Label>
            <Input
              id="work_unit_label"
              value={workUnitLabel}
              onChange={(e) => setWorkUnitLabel(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="sub_unit_label">Sub unit label</Label>
            <Input
              id="sub_unit_label"
              value={subUnitLabel}
              onChange={(e) => setSubUnitLabel(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="work_item_label">Work item label</Label>
            <Input
              id="work_item_label"
              value={workItemLabel}
              onChange={(e) => setWorkItemLabel(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="work_item_mode">Mode</Label>
            <select
              id="work_item_mode"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={workItemMode}
              onChange={(e) => setWorkItemMode(e.target.value as "atomic" | "metric")}
            >
              <option value="atomic">atomic</option>
              <option value="metric">metric</option>
            </select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Saving…" : "Save labels"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
