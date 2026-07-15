"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { apiFetch } from "@/components/_lib/api";

type RequestRow = {
  id: string;
  type: string;
  status: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  amount?: string | null;
  employeeId: string;
};

export function RequestsScreen() {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [canApprove, setCanApprove] = useState(false);
  const [type, setType] = useState("leave_paid");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function refresh() {
    const res = await apiFetch<RequestRow[]>("/requests");
    if (res.data) setRequests(res.data);
  }

  useEffect(() => {
    refresh();
    apiFetch<{ role: string }>("/auth/me").then((res) => {
      if (res.data) setCanApprove(res.data.role === "admin" || res.data.role === "hr");
    });
  }, []);

  const isLeave = type === "leave_paid" || type === "leave_unpaid";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const body: Record<string, unknown> = { type, description: description || undefined };
    if (isLeave) {
      body.dateFrom = dateFrom;
      body.dateTo = dateTo;
    } else if (type === "reimbursement") {
      body.amount = Number(amount);
    }
    const res = await apiFetch("/requests", { method: "POST", body: JSON.stringify(body) });
    if (res.error) {
      setError(`${res.error.code}: ${res.error.message}`);
      return;
    }
    setDateFrom("");
    setDateTo("");
    setAmount("");
    setDescription("");
    refresh();
  }

  async function decide(id: string, action: "approve" | "reject") {
    setActionError(null);
    const res = await apiFetch(`/requests/${id}/${action}`, { method: "PATCH" });
    if (res.error) setActionError(`${res.error.code}: ${res.error.message}`);
    refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Requests</h1>
        <p className="text-sm text-muted-foreground">
          Leave &amp; reimbursement requests. Approval is Admin/HR only.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Submit a request</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Type</Label>
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="leave_paid">Paid leave</option>
                <option value="leave_unpaid">Unpaid leave</option>
                <option value="reimbursement">Reimbursement</option>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Description (optional)</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
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
              <div className="flex flex-col gap-1.5">
                <Label>Amount (₹)</Label>
                <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required />
              </div>
            )}
            {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
            <Button type="submit" className="w-fit sm:col-span-2">
              Submit
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Requests</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {actionError && <p className="text-sm text-destructive">{actionError}</p>}
          {requests.length === 0 && <p className="text-sm text-muted-foreground">None visible.</p>}
          {requests.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded border p-3 text-sm">
              <span>
                {r.type}{" "}
                {r.amount
                  ? `— ₹${r.amount}`
                  : r.dateFrom
                    ? `— ${r.dateFrom.slice(0, 10)} to ${r.dateTo?.slice(0, 10)}`
                    : ""}
              </span>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{r.status}</Badge>
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
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
