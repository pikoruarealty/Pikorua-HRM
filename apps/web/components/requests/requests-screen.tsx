"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiFetch } from "@/components/_lib/api";

type EmployeeSummary = {
  id: string;
  fullName: string;
  email: string;
  role: string;
  department?: { name: string } | null;
  team?: { name: string } | null;
};

type RequestRow = {
  id: string;
  type: string;
  status: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  amount?: string | null;
  description?: string | null;
  createdAt: string;
  approvedAt?: string | null;
  employeeId: string;
  employee?: EmployeeSummary | null;
  hasAttachment?: boolean;
};

const TYPE_LABELS: Record<string, string> = {
  leave_paid: "Paid leave",
  leave_unpaid: "Unpaid leave",
  reimbursement: "Reimbursement",
  wfh: "Work from home",
  other: "Other",
};

const STATUS_VARIANT: Record<string, "outline" | "success" | "warning" | "muted"> = {
  pending: "warning",
  approved: "success",
  rejected: "muted",
};

function fmtDate(d?: string | null) {
  if (!d) return "";
  return new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

export function RequestsScreen() {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [canApprove, setCanApprove] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [myUserRole, setMyUserRole] = useState<string | null>(null);

  // Submit form
  const [type, setType] = useState("leave_paid");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [bill, setBill] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Filters
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterEmployee, setFilterEmployee] = useState("all");

  async function refresh() {
    const res = await apiFetch<RequestRow[]>("/requests");
    if (res.data) setRequests(res.data);
  }

  useEffect(() => {
    refresh();
    apiFetch<{ role: string }>("/auth/me").then((res) => {
      if (res.data) {
        setMyUserRole(res.data.role);
        setCanApprove(res.data.role === "admin" || res.data.role === "hr");
        setIsAdmin(res.data.role === "admin");
      }
    });
  }, []);

  const isLeave = type === "leave_paid" || type === "leave_unpaid";
  const canFilterByEmployee = canApprove; // only finance ever sees more than one person's rows

  // Distinct employees present in the current result set, for the employee filter.
  const employeeOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of requests) {
      if (r.employee) map.set(r.employee.id, r.employee.fullName);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [requests]);

  const visible = requests.filter(
    (r) =>
      (filterType === "all" || r.type === filterType) &&
      (filterStatus === "all" || r.status === filterStatus) &&
      (filterEmployee === "all" || r.employeeId === filterEmployee),
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    let res;
    if (type === "reimbursement") {
      // Multipart so the bill (image/pdf) can ride along.
      const form = new FormData();
      form.set("type", type);
      form.set("amount", amount);
      if (description) form.set("description", description);
      if (bill) form.set("bill", bill);
      res = await apiFetch("/requests", { method: "POST", body: form });
    } else {
      const body: Record<string, unknown> = { type, description: description || undefined };
      if (isLeave) {
        body.dateFrom = dateFrom;
        body.dateTo = dateTo;
      }
      res = await apiFetch("/requests", { method: "POST", body: JSON.stringify(body) });
    }

    setSubmitting(false);
    if (res.error) {
      setError(`${res.error.code}: ${res.error.message}`);
      return;
    }
    setDateFrom("");
    setDateTo("");
    setAmount("");
    setDescription("");
    setBill(null);
    refresh();
  }

  async function decide(id: string, action: "approve" | "reject") {
    setActionError(null);
    const res = await apiFetch(`/requests/${id}/${action}`, { method: "PATCH" });
    if (res.error) setActionError(`${res.error.code}: ${res.error.message}`);
    refresh();
  }

  async function override(id: string, status: "pending" | "approved" | "rejected") {
    const reason = prompt(`Reason for overriding this request to "${status}"?`);
    if (!reason) return;
    setActionError(null);
    const res = await apiFetch(`/requests/${id}/override`, {
      method: "PATCH",
      body: JSON.stringify({ status, reason }),
    });
    if (res.error) setActionError(`${res.error.code}: ${res.error.message}`);
    refresh();
  }

  const canSubmit = myUserRole !== "admin"; // Admin has no one above to approve its own request

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Requests</h1>
        <p className="text-sm text-muted-foreground">
          Leave &amp; reimbursement requests. Approval is Admin/HR only.
        </p>
      </div>

      {canSubmit && (
        <Card>
          <CardHeader>
            <CardTitle>Submit a request</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>Type</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="leave_paid">Paid leave</SelectItem>
                    <SelectItem value="leave_unpaid">Unpaid leave</SelectItem>
                    <SelectItem value="reimbursement">Reimbursement</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{type === "reimbursement" ? "What is this for?" : "Reason (optional)"}</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={type === "reimbursement" ? "e.g. client dinner, travel" : "e.g. family function"}
                  required={type === "reimbursement"}
                />
              </div>
              {isLeave ? (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label>Date from</Label>
                    <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} required />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Date to</Label>
                    <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} required />
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label>Amount (₹)</Label>
                    <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required />
                  </div>
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <Label>Bill / receipt (PDF or image)</Label>
                    <Input
                      type="file"
                      accept="application/pdf,image/png,image/jpeg,image/gif,image/webp"
                      onChange={(e) => setBill(e.target.files?.[0] ?? null)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Optional but recommended — only Admin/HR (and you) can view it.
                    </p>
                  </div>
                </>
              )}
              {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
              <Button type="submit" className="w-fit sm:col-span-2" disabled={submitting}>
                {submitting ? "Submitting…" : "Submit"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Requests</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Filters */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Type</Label>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="h-9 w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="leave_paid">Paid leave</SelectItem>
                  <SelectItem value="leave_unpaid">Unpaid leave</SelectItem>
                  <SelectItem value="reimbursement">Reimbursement</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-9 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {canFilterByEmployee && employeeOptions.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Employee</Label>
                <Select value={filterEmployee} onValueChange={setFilterEmployee}>
                  <SelectTrigger className="h-9 w-52">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All employees</SelectItem>
                    {employeeOptions.map(([id, name]) => (
                      <SelectItem key={id} value={id}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <span className="ml-auto text-xs text-muted-foreground">
              {visible.length} of {requests.length}
            </span>
          </div>

          {actionError && <p className="text-sm text-destructive">{actionError}</p>}
          {visible.length === 0 && <p className="text-sm text-muted-foreground">No requests match.</p>}

          <div className="flex flex-col gap-3">
            {visible.map((r) => (
              <div key={r.id} className="flex flex-col gap-2 rounded-lg border p-4 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{TYPE_LABELS[r.type] ?? r.type}</span>
                      <Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>{r.status}</Badge>
                    </div>
                    {r.employee && (
                      <span className="text-muted-foreground">
                        {r.employee.fullName}
                        {r.employee.team?.name ? ` · ${r.employee.team.name}` : ""}
                        {r.employee.department?.name ? ` · ${r.employee.department.name}` : ""}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">Filed {fmtDate(r.createdAt)}</span>
                </div>

                <div className="flex flex-wrap gap-x-6 gap-y-1 text-muted-foreground">
                  {r.dateFrom && (
                    <span>
                      <span className="text-foreground">Dates:</span> {fmtDate(r.dateFrom)} → {fmtDate(r.dateTo)}
                    </span>
                  )}
                  {r.type === "reimbursement" && (
                    <span>
                      <span className="text-foreground">Amount:</span>{" "}
                      {r.amount != null ? `₹${r.amount}` : <span className="italic">hidden</span>}
                    </span>
                  )}
                  {r.description && (
                    <span>
                      <span className="text-foreground">For:</span> {r.description}
                    </span>
                  )}
                  {r.approvedAt && (
                    <span>
                      <span className="text-foreground">Decided:</span> {fmtDate(r.approvedAt)}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {r.type === "reimbursement" && r.hasAttachment && (
                    <a
                      href={`/api/v1/requests/${r.id}/attachment`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand hover:underline"
                    >
                      View bill
                    </a>
                  )}
                  <span className="ml-auto flex items-center gap-2">
                    {r.status === "pending" && canApprove && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => decide(r.id, "approve")}>
                          Approve
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => decide(r.id, "reject")}>
                          Reject
                        </Button>
                      </>
                    )}
                    {r.status !== "pending" && isAdmin && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => override(r.id, "pending")}>
                          Reopen
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => override(r.id, r.status === "approved" ? "rejected" : "approved")}
                        >
                          Force {r.status === "approved" ? "reject" : "approve"}
                        </Button>
                      </>
                    )}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
