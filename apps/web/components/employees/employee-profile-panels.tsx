"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Profile page panels (2026-07-15): the employee's request history and
// payslips, so the individual profile shows everything about a person in one
// place. Both endpoints scope server-side; these panels just render what the
// caller is allowed to see (payslips panel is additionally gated by the page
// to Admin/HR or self, per the golden rule).

async function getJson(res: Response) {
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data;
}

type RequestRow = {
  id: string;
  type: string;
  status: "pending" | "approved" | "rejected";
  dateFrom: string | null;
  dateTo: string | null;
  amount: string | null;
  description: string | null;
  createdAt: string;
};

const STATUS_VARIANTS: Record<RequestRow["status"], "default" | "destructive" | "outline"> = {
  approved: "default",
  rejected: "destructive",
  pending: "outline",
};

function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}

export function EmployeeRequestsPanel({
  employeeId,
  showAmounts,
}: {
  employeeId: string;
  /** Amounts are golden-rule data — page passes true only for Admin/HR/self. */
  showAmounts: boolean;
}) {
  const [requests, setRequests] = useState<RequestRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setRequests(await getJson(await fetch(`/api/v1/requests?employee_id=${employeeId}`)));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load requests.");
      }
    })();
  }, [employeeId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Requests</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-muted-foreground">{error}</p>
        ) : requests === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">No requests yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Dates</TableHead>
                {showAmounts && <TableHead>Amount</TableHead>}
                <TableHead>Status</TableHead>
                <TableHead>Submitted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.type.replace(/_/g, " ")}</TableCell>
                  <TableCell>
                    {r.dateFrom ? `${fmtDate(r.dateFrom)} → ${fmtDate(r.dateTo)}` : "—"}
                  </TableCell>
                  {showAmounts && <TableCell>{r.amount ?? "—"}</TableCell>}
                  <TableCell>
                    <Badge variant={STATUS_VARIANTS[r.status]}>{r.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(r.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

type PayslipRow = {
  id: string;
  periodMonth: number;
  periodYear: number;
  netPay: string;
  status: "draft" | "finalized";
  generatedAt: string;
};

export function EmployeePayslipsPanel({ employeeId }: { employeeId: string }) {
  const router = useRouter();
  const [payslips, setPayslips] = useState<PayslipRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setPayslips(await getJson(await fetch(`/api/v1/payslips?employee_id=${employeeId}`)));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load payslips.");
      }
    })();
  }, [employeeId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payslips</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-muted-foreground">{error}</p>
        ) : payslips === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : payslips.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payslips yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Net pay</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Generated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payslips.map((p) => (
                <TableRow
                  key={p.id}
                  onClick={() => router.push(`/payslips/${p.id}`)}
                  className="cursor-pointer hover:bg-muted/50"
                >
                  <TableCell>
                    {p.periodMonth}/{p.periodYear}
                  </TableCell>
                  <TableCell className="tabular-nums">{p.netPay}</TableCell>
                  <TableCell>
                    <Badge variant={p.status === "finalized" ? "default" : "outline"}>{p.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(p.generatedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
