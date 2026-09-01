"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { Button, buttonVariants } from "@/components/ui/button";
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

type LeaveBalance = {
  employeeId: string;
  fullName: string;
  periodMonth: number;
  periodYear: number;
  month: { allowance: number; used: number; compensated: number; remaining: number };
  year: { allowance: number; used: number; compensated: number; remaining: number };
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
  const [myEmployeeId, setMyEmployeeId] = useState<string | null>(null);

  // Self-service edit (own pending request only)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDateFrom, setEditDateFrom] = useState("");
  const [editDateTo, setEditDateTo] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);

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

  // Leave balance (self). Admin/HR edit the allowance itself on the
  // dedicated /leave-config screen, not here.
  const [balance, setBalance] = useState<LeaveBalance | null>(null);

  async function refresh() {
    const res = await apiFetch<RequestRow[]>("/requests");
    if (res.data) setRequests(res.data);
  }

  useEffect(() => {
    refresh();
    apiFetch<{ role: string; employee: { id: string } | null }>("/auth/me").then((res) => {
      if (res.data) {
        setMyUserRole(res.data.role);
        const finance = res.data.role === "admin" || res.data.role === "hr";
        setCanApprove(finance);
        setIsAdmin(res.data.role === "admin");
        setMyEmployeeId(res.data.employee?.id ?? null);
        if (res.data.employee?.id) {
          apiFetch<LeaveBalance>("/leave-config/balance").then((b) => {
            if (b.data) setBalance(b.data);
          });
        }
      }
    });
  }, []);

  const isLeave = type === "leave_paid" || type === "leave_unpaid";
  // Only offer paid leave once there's actual balance left to spend — before
  // the balance loads, don't hide it on a false "0 remaining" flash.
  const hasPaidLeaveBalance = !balance || balance.month.remaining > 0 || balance.year.remaining > 0;
  useEffect(() => {
    if (type === "leave_paid" && balance && !hasPaidLeaveBalance) {
      setType("leave_unpaid");
    }
  }, [balance, hasPaidLeaveBalance, type]);
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

  async function decide(id: string, action: "approve" | "reject", body?: Record<string, unknown>) {
    setActionError(null);
    const res = await apiFetch(`/requests/${id}/${action}`, {
      method: "PATCH",
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.error) setActionError(`${res.error.code}: ${res.error.message}`);
    refresh();
  }

  // Partial leave approval (owner request, 2026-09-01): let Admin/HR flip
  // individual days of a multi-day leave request to the other paid/unpaid
  // type before confirming, instead of only all-or-nothing approval.
  const [splittingId, setSplittingId] = useState<string | null>(null);
  const [dayTypes, setDayTypes] = useState<Record<string, "leave_paid" | "leave_unpaid">>({});

  function datesInRange(from: string, to: string): string[] {
    const dates: string[] = [];
    const start = new Date(`${from.slice(0, 10)}T00:00:00.000Z`);
    const end = new Date(`${to.slice(0, 10)}T00:00:00.000Z`);
    for (let d = start; d <= end; d = new Date(d.getTime() + 86400000)) {
      dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
  }

  function openSplit(r: RequestRow) {
    if (!r.dateFrom || !r.dateTo) return;
    const dates = datesInRange(r.dateFrom, r.dateTo);
    const base = r.type as "leave_paid" | "leave_unpaid";
    setDayTypes(Object.fromEntries(dates.map((d) => [d, base])));
    setSplittingId(r.id);
  }

  function toggleDayType(date: string) {
    setDayTypes((prev) => ({
      ...prev,
      [date]: prev[date] === "leave_paid" ? "leave_unpaid" : "leave_paid",
    }));
  }

  async function confirmSplitApprove(r: RequestRow) {
    const overrides = Object.entries(dayTypes)
      .filter(([, t]) => t !== r.type)
      .map(([date, type]) => ({ date, type }));
    await decide(r.id, "approve", overrides.length > 0 ? { day_overrides: overrides } : undefined);
    setSplittingId(null);
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

  function startEdit(r: RequestRow) {
    setEditingId(r.id);
    setEditDateFrom(r.dateFrom ? r.dateFrom.slice(0, 10) : "");
    setEditDateTo(r.dateTo ? r.dateTo.slice(0, 10) : "");
    setEditAmount(r.amount != null ? String(r.amount) : "");
    setEditDescription(r.description ?? "");
    setActionError(null);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(r: RequestRow) {
    setEditSubmitting(true);
    setActionError(null);
    const isLeaveRow = r.type === "leave_paid" || r.type === "leave_unpaid";
    const body: Record<string, unknown> = { description: editDescription || undefined };
    if (isLeaveRow) {
      body.dateFrom = editDateFrom;
      body.dateTo = editDateTo;
    } else if (r.type === "reimbursement") {
      body.amount = editAmount ? Number(editAmount) : undefined;
    }
    const res = await apiFetch(`/requests/${r.id}`, { method: "PATCH", body: JSON.stringify(body) });
    setEditSubmitting(false);
    if (res.error) {
      setActionError(`${res.error.code}: ${res.error.message}`);
      return;
    }
    setEditingId(null);
    refresh();
  }

  async function deleteOwn(id: string) {
    if (!confirm("Delete this request? This cannot be undone.")) return;
    setActionError(null);
    const res = await apiFetch(`/requests/${id}`, { method: "DELETE" });
    if (res.error) setActionError(`${res.error.code}: ${res.error.message}`);
    refresh();
  }

  // No role is forbidden from filing its own request (2026-09-01) — Admin's
  // own pending request can still be actioned by another Admin/HR account.
  const canSubmit = true;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Requests</h1>
        <p className="text-sm text-muted-foreground">
          Leave &amp; reimbursement requests. Approval is Admin/HR only.
        </p>
      </div>

      {balance && (
        <Card>
          <CardHeader>
            <CardTitle>My leave balance</CardTitle>
          </CardHeader>
          <CardContent>
            {balance.month.allowance === 0 && balance.year.allowance === 0 ? (
              <p className="text-sm text-muted-foreground">
                No paid-leave allowance has been configured yet — check with Admin/HR.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <BalanceStat label="This month — used" value={balance.month.used} />
                <BalanceStat label="This month — remaining" value={balance.month.remaining} highlight />
                <BalanceStat label="This year — used" value={balance.year.used} />
                <BalanceStat label="This year — remaining" value={balance.year.remaining} highlight />
              </div>
            )}
            {(balance.month.compensated > 0 || balance.year.compensated > 0) && (
              <p className="mt-3 text-xs text-muted-foreground">
                Includes {balance.year.compensated} compensation day{balance.year.compensated === 1 ? "" : "s"} credited
                back this year.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {canApprove && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <p className="text-sm text-muted-foreground">
              The paid-leave allowance (full-time/part-time/intern) is managed on its own screen.
            </p>
            <Link href="/leave-config" className={buttonVariants({ size: "sm", variant: "outline" })}>
              Open leave config
            </Link>
          </CardContent>
        </Card>
      )}

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
                    {hasPaidLeaveBalance && <SelectItem value="leave_paid">Paid leave</SelectItem>}
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
                    <DatePicker value={dateFrom} onChange={setDateFrom} required />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Date to</Label>
                    <DatePicker value={dateTo} onChange={setDateTo} required />
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

                {editingId === r.id ? (
                  <div className="flex flex-wrap items-end gap-3 rounded border bg-muted/30 p-3">
                    {(r.type === "leave_paid" || r.type === "leave_unpaid") ? (
                      <>
                        <div className="flex flex-col gap-1.5">
                          <Label className="text-xs">Date from</Label>
                          <DatePicker value={editDateFrom} onChange={setEditDateFrom} />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label className="text-xs">Date to</Label>
                          <DatePicker value={editDateTo} onChange={setEditDateTo} />
                        </div>
                      </>
                    ) : r.type === "reimbursement" ? (
                      <div className="flex flex-col gap-1.5">
                        <Label className="text-xs">Amount (₹)</Label>
                        <Input
                          type="number"
                          value={editAmount}
                          onChange={(e) => setEditAmount(e.target.value)}
                        />
                      </div>
                    ) : null}
                    <div className="flex flex-1 min-w-40 flex-col gap-1.5">
                      <Label className="text-xs">Reason / notes</Label>
                      <Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => saveEdit(r)} disabled={editSubmitting}>
                        {editSubmitting ? "Saving…" : "Save"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={cancelEdit}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
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
                )}

                {splittingId === r.id && r.dateFrom && r.dateTo && (
                  <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">
                      Click a day to toggle it between paid and unpaid before approving. Unpaid days are
                      deducted from pay; paid days are not.
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {datesInRange(r.dateFrom, r.dateTo).map((date) => {
                        const dType = dayTypes[date] ?? r.type;
                        return (
                          <button
                            type="button"
                            key={date}
                            onClick={() => toggleDayType(date)}
                            className={`rounded-md border px-2 py-1 text-xs ${
                              dType === "leave_paid"
                                ? "border-emerald-600 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                                : "border-amber-600 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                            }`}
                          >
                            {fmtDate(date)} · {dType === "leave_paid" ? "Paid" : "Unpaid"}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => confirmSplitApprove(r)}>
                        Confirm approval
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setSplittingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

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
                    {r.status === "pending" && r.employeeId === myEmployeeId && editingId !== r.id && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => startEdit(r)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => deleteOwn(r.id)}>
                          Delete
                        </Button>
                      </>
                    )}
                    {r.status === "pending" && canApprove && splittingId !== r.id && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const isLeaveRow = r.type === "leave_paid" || r.type === "leave_unpaid";
                            const isMultiDay = r.dateFrom && r.dateTo && r.dateFrom.slice(0, 10) !== r.dateTo.slice(0, 10);
                            if (isLeaveRow && isMultiDay) openSplit(r);
                            else decide(r.id, "approve");
                          }}
                        >
                          Approve
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => decide(r.id, "reject")}>
                          Reject
                        </Button>
                      </>
                    )}
                    {r.status !== "pending" && isAdmin && (
                      <Button size="sm" variant="ghost" onClick={() => override(r.id, "pending")}>
                        Reopen
                      </Button>
                    )}
                    {isAdmin && (
                      <Button size="sm" variant="ghost" onClick={() => deleteOwn(r.id)}>
                        Delete (admin)
                      </Button>
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

function BalanceStat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`text-2xl font-bold tabular-nums ${highlight ? "text-brand" : ""}`}>{value}</dd>
    </div>
  );
}
