"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type RoleTier = "finance" | "lead" | "employee";

type RoleRow = {
  key: string;
  label: string;
  tier: RoleTier;
  isSystem: boolean;
};

const TIER_LABEL: Record<RoleTier, string> = {
  finance: "Finance (Admin/HR-level access)",
  lead: "Lead",
  employee: "Employee",
};

async function getJson(res: Response) {
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data;
}

export function RolesScreen() {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setRoles(await getJson(await fetch("/api/v1/roles")));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load roles.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onDelete(key: string) {
    setDeletingKey(key);
    setError(null);
    try {
      await getJson(await fetch(`/api/v1/roles/${key}`, { method: "DELETE" }));
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete role.");
    } finally {
      setDeletingKey(null);
    }
  }

  const editingRole = roles.find((r) => r.key === editingKey) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Roles</h1>
        <p className="text-sm text-muted-foreground">
          The original 7 roles are protected. Add a custom role here — it becomes selectable
          immediately in employee create/edit, with permissions matching the tier you pick.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <CreateRoleForm onCreated={load} />

      <Card>
        <CardHeader>
          <CardTitle>All roles</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead />
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {roles.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="font-mono text-xs">{r.key}</TableCell>
                    <TableCell>
                      {editingKey === r.key ? (
                        <EditRoleForm
                          role={r}
                          onSaved={() => {
                            setEditingKey(null);
                            load();
                          }}
                          onCancel={() => setEditingKey(null)}
                        />
                      ) : (
                        r.label
                      )}
                    </TableCell>
                    <TableCell>
                      {editingKey === r.key ? null : TIER_LABEL[r.tier]}
                    </TableCell>
                    <TableCell>
                      {r.isSystem && <Badge variant="outline">system</Badge>}
                    </TableCell>
                    <TableCell className="flex justify-end gap-2">
                      {editingKey !== r.key && (
                        <Button variant="outline" size="sm" onClick={() => setEditingKey(r.key)}>
                          Edit
                        </Button>
                      )}
                      {!r.isSystem && editingKey !== r.key && (
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={deletingKey === r.key}
                          onClick={() => onDelete(r.key)}
                        >
                          {deletingKey === r.key ? "Deleting…" : "Delete"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CreateRoleForm({ onCreated }: { onCreated: () => void }) {
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [tier, setTier] = useState<RoleTier>("employee");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await getJson(
        await fetch("/api/v1/roles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, label, tier }),
        }),
      );
      setKey("");
      setLabel("");
      setTier("employee");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create role.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New role</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="role_key">Key</Label>
            <Input
              id="role_key"
              placeholder="e.g. cto"
              value={key}
              onChange={(e) => setKey(e.target.value.toLowerCase())}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="role_label">Label</Label>
            <Input
              id="role_label"
              placeholder="e.g. CTO"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="role_tier">Access tier</Label>
            <Select value={tier} onValueChange={(v) => setTier(v as RoleTier)}>
              <SelectTrigger id="role_tier" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="finance">{TIER_LABEL.finance}</SelectItem>
                <SelectItem value="lead">{TIER_LABEL.lead}</SelectItem>
                <SelectItem value="employee">{TIER_LABEL.employee}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create role"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function EditRoleForm({
  role,
  onSaved,
  onCancel,
}: {
  role: RoleRow;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(role.label);
  const [tier, setTier] = useState<RoleTier>(role.tier);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await getJson(
        await fetch(`/api/v1/roles/${role.key}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label, tier }),
        }),
      );
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save role.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      <Input value={label} onChange={(e) => setLabel(e.target.value)} className="w-40" required />
      <Select value={tier} onValueChange={(v) => setTier(v as RoleTier)} disabled={role.isSystem}>
        <SelectTrigger className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="finance">{TIER_LABEL.finance}</SelectItem>
          <SelectItem value="lead">{TIER_LABEL.lead}</SelectItem>
          <SelectItem value="employee">{TIER_LABEL.employee}</SelectItem>
        </SelectContent>
      </Select>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" size="sm" disabled={submitting}>
        {submitting ? "Saving…" : "Save"}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}
