"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type PayrollConfig = {
  id: string;
  lateDeductionPercent: string;
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

  const [lateDeductionPercent, setLateDeductionPercent] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await getJson(await fetch("/api/v1/payroll/config"));
      setConfig(data);
      if (data) {
        setLateDeductionPercent(data.lateDeductionPercent);
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
            late_deduction_percent: lateDeductionPercent,
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
          Deduction rates used when generating payslips — proportional to each employee&apos;s own
          salary (per-day rate = base salary ÷ 30), not flat company-wide amounts.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Current rate</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !config ? (
            <p className="text-sm text-muted-foreground">
              No payroll config exists yet{canEdit ? " — set one below." : "."}
            </p>
          ) : (
            <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">Late deduction</dt>
                <dd className="font-medium">{config.lateDeductionPercent}% of a day&apos;s pay</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Effective from</dt>
                <dd className="font-medium">
                  {new Date(config.effectiveFrom).toLocaleDateString()}
                </dd>
              </div>
            </dl>
          )}
          <p className="text-xs text-muted-foreground">
            Half-day deducts 50% of a day&apos;s pay, and unpaid leave / absent days each deduct a
            full day&apos;s pay — these are fixed fractions of each employee&apos;s own salary, not
            separately configurable.
          </p>
        </CardContent>
      </Card>

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Set a new rate</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              This inserts a new versioned rate row — it never overwrites the current one, so
              payslips already generated stay reproducible against the rate that was effective
              at the time.
            </p>
            <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="late">Late deduction (% of a day&apos;s pay)</Label>
                <Input
                  id="late"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  required
                  value={lateDeductionPercent}
                  onChange={(e) => setLateDeductionPercent(e.target.value)}
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
                {submitting ? "Saving…" : "Save new rate"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
