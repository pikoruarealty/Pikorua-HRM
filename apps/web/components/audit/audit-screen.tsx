"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetch } from "@/components/_lib/api";

type AuditLog = {
  id: string;
  action: string;
  actorRole: string | null;
  actor: { email: string; role: string } | null;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
};

type AuditResponse = {
  logs: AuditLog[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

// Action-prefix filter options — grouped by entity, matching the
// "<entity>.<verb>" convention in lib/audit.
const ACTION_FILTERS = [
  { value: "all", label: "All actions" },
  { value: "auth.", label: "Auth (logins, password changes)" },
  { value: "payslip.", label: "Payslips" },
  { value: "payroll_config.", label: "Payroll config" },
  { value: "attendance.", label: "Attendance" },
  { value: "request.", label: "Requests" },
  { value: "employee.", label: "Employees" },
];

export function AuditScreen() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [action, setAction] = useState("all");
  const [entityId, setEntityId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const params = new URLSearchParams({ page: String(page), limit: "50" });
    if (action !== "all") params.set("action", action);
    if (entityId.trim()) params.set("entity_id", entityId.trim());
    const res = await apiFetch<AuditResponse>(`/audit-logs?${params}`);
    if (res.error) {
      setError(`${res.error.code}: ${res.error.message}`);
      return;
    }
    if (res.data) {
      setLogs(res.data.logs);
      setTotalPages(res.data.pagination.totalPages);
      setTotal(res.data.pagination.total);
    }
  }, [page, action, entityId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Audit Log</h1>
        <p className="text-sm text-muted-foreground">
          Append-only trail of sensitive actions — logins, payslip generation, payroll config,
          attendance edits, request approvals, employee changes. Admin only.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="flex w-64 flex-col gap-1.5">
            <Label>Action</Label>
            <Select
              value={action}
              onValueChange={(v) => {
                setPage(1);
                setAction(v);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTION_FILTERS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex w-80 flex-col gap-1.5">
            <Label>Entity ID</Label>
            <Input
              placeholder="uuid of a payslip / employee / request…"
              value={entityId}
              onChange={(e) => {
                setPage(1);
                setEntityId(e.target.value);
              }}
            />
          </div>
          <p className="pb-2 text-xs text-muted-foreground">{total} matching entries</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Entries</CardTitle>
          <div className="flex items-center gap-2 text-sm">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Prev
            </Button>
            <span className="text-muted-foreground">
              {page} / {totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {logs.length === 0 && !error && (
            <p className="text-sm text-muted-foreground">No audit entries match these filters.</p>
          )}
          {logs.map((log) => (
            <button
              key={log.id}
              type="button"
              className="rounded border p-3 text-left text-sm hover:bg-muted/50"
              onClick={() => setExpanded(expanded === log.id ? null : log.id)}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{log.action}</Badge>
                <span className="font-medium">{log.actor?.email ?? "unauthenticated"}</span>
                {log.actorRole && <span className="text-muted-foreground">({log.actorRole})</span>}
                <span className="ml-auto text-xs text-muted-foreground">
                  {new Date(log.createdAt).toLocaleString()}
                </span>
              </div>
              {log.entityType && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {log.entityType} {log.entityId ?? ""}
                  {log.ip ? ` · from ${log.ip}` : ""}
                </p>
              )}
              {expanded === log.id && log.metadata && (
                <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs">
                  {JSON.stringify(log.metadata, null, 2)}
                </pre>
              )}
            </button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
