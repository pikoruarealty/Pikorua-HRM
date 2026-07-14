"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { apiFetch } from "../_lib/api";

type LedgerEntry = { id: string; points: number; creditedAt: string; workItem: { id: string; title: string } | null };
type PointsResult = { employeeId: string; balance: number; ledger: LedgerEntry[] };
type Employee = { id: string; fullName: string; role: string };

export default function PointsPage() {
  const [employeeId, setEmployeeId] = useState("");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [result, setResult] = useState<PointsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/test/employees").then((r) => r.json()).then((json) => {
      if (json.data) setEmployees(json.data);
    });
  }, []);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await apiFetch<PointsResult>(`/employees/${employeeId}/points`);
    if (res.error) {
      setError(`${res.error.code}: ${res.error.message}`);
      setResult(null);
      return;
    }
    setResult(res.data);
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Points ledger (GET /employees/:id/points)</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={lookup} className="flex items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <Label>Employee (use your own for self, or a report&apos;s if Lead/Admin/HR)</Label>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                required
              >
                <option value="">Select an employee…</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.fullName} ({emp.role})</option>
                ))}
              </select>
            </div>
            <Button type="submit">Look up</Button>
          </form>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Balance: {result.balance} pts</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {result.ledger.map((entry) => (
              <div key={entry.id} className="flex justify-between rounded border p-2 text-sm">
                <span>{entry.workItem?.title ?? "—"}</span>
                <span>+{entry.points} pts on {new Date(entry.creditedAt).toLocaleDateString()}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
