"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type PayrollConfig = {
  id: string;
  lateDeductionFlat: string;
  unpaidLeaveDeductionFlat: string;
  halfDayDeductionFlat: string;
  effectiveFrom: string;
};

async function getJson(res: Response) {
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data;
}

export function PayrollConfigScreen({ canEdit }: { canEdit: boolean }) {
  const [config, setConfig] = useState<PayrollConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [lateDeduction, setLateDeduction] = useState("");
  const [halfDayDeduction, setHalfDayDeduction] = useState("");
  const [unpaidLeaveDeduction, setUnpaidLeaveDeduction] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await getJson(await fetch("/api/v1/payroll/config"));
      setConfig(data);
      if (data) {
        setLateDeduction(data.lateDeductionFlat);
        setHalfDayDeduction(data.halfDayDeductionFlat);
        setUnpaidLeaveDeduction(data.unpaidLeaveDeductionFlat);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load payroll config.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSaveError(null);
    try {
      await getJson(
        await fetch("/api/v1/payroll/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            late_deduction_flat: lateDeduction,
            half_day_deduction_flat: halfDayDeduction,
            unpaid_leave_deduction_flat: unpaidLeaveDeduction,
            effective_from: effectiveFrom,
          }),
        }),
      );
      await load();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Payroll config</h1>
        <p className="text-sm text-muted-foreground">
          Flat per-occurrence deduction rates used when generating payslips.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Current rates</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !config ? (
            <p className="text-sm text-muted-foreground">
              No payroll config exists yet{canEdit ? " — set one below." : "."}
            </p>
          ) : (
            <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">Late (per day)</dt>
                <dd className="font-medium">₹{config.lateDeductionFlat}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Half-day (per day)</dt>
                <dd className="font-medium">₹{config.halfDayDeductionFlat}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Unpaid leave (per day)</dt>
                <dd className="font-medium">₹{config.unpaidLeaveDeductionFlat}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Effective from</dt>
                <dd className="font-medium">
                  {new Date(config.effectiveFrom).toLocaleDateString()}
                </dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Set new rates</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              This inserts a new versioned rate row — it never overwrites the current one, so
              payslips already generated stay reproducible against the rates that were effective
              at the time.
            </p>
            <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="late">Late deduction (₹/day)</Label>
                <Input
                  id="late"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={lateDeduction}
                  onChange={(e) => setLateDeduction(e.target.value)}
                  className="w-40"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="halfday">Half-day deduction (₹/day)</Label>
                <Input
                  id="halfday"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={halfDayDeduction}
                  onChange={(e) => setHalfDayDeduction(e.target.value)}
                  className="w-40"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="unpaid">Unpaid leave deduction (₹/day)</Label>
                <Input
                  id="unpaid"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={unpaidLeaveDeduction}
                  onChange={(e) => setUnpaidLeaveDeduction(e.target.value)}
                  className="w-40"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="effective">Effective from</Label>
                <Input
                  id="effective"
                  type="date"
                  required
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                  className="w-40"
                />
              </div>
              {saveError && <p className="w-full text-sm text-destructive">{saveError}</p>}
              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving…" : "Save new rates"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
