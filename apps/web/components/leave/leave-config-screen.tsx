"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format-date";

type LeaveConfig = {
  id: string;
  paidLeavesPerMonth: number;
  paidLeavesPerYear: number;
  partTimePaidLeavesPerMonth: number;
  partTimePaidLeavesPerYear: number;
  internPaidLeavesPerMonth: number;
  internPaidLeavesPerYear: number;
  effectiveFrom: string;
} | null;

async function getJson(res: Response) {
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data;
}

export function LeaveConfigScreen({ canEdit }: { canEdit: boolean }) {
  const [config, setConfig] = useState<LeaveConfig>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [paidLeavesPerMonth, setPaidLeavesPerMonth] = useState("");
  const [paidLeavesPerYear, setPaidLeavesPerYear] = useState("");
  const [partTimePerMonth, setPartTimePerMonth] = useState("");
  const [partTimePerYear, setPartTimePerYear] = useState("");
  const [internPerMonth, setInternPerMonth] = useState("");
  const [internPerYear, setInternPerYear] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data: LeaveConfig = await getJson(await fetch("/api/v1/leave-config"));
      setConfig(data);
      if (data) {
        setPaidLeavesPerMonth(String(data.paidLeavesPerMonth));
        setPaidLeavesPerYear(String(data.paidLeavesPerYear));
        setPartTimePerMonth(String(data.partTimePaidLeavesPerMonth));
        setPartTimePerYear(String(data.partTimePaidLeavesPerYear));
        setInternPerMonth(String(data.internPaidLeavesPerMonth));
        setInternPerYear(String(data.internPaidLeavesPerYear));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load leave config.");
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
        await fetch("/api/v1/leave-config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paid_leaves_per_month: paidLeavesPerMonth,
            paid_leaves_per_year: paidLeavesPerYear,
            part_time_paid_leaves_per_month: partTimePerMonth || undefined,
            part_time_paid_leaves_per_year: partTimePerYear || undefined,
            intern_paid_leaves_per_month: internPerMonth || undefined,
            intern_paid_leaves_per_year: internPerYear || undefined,
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
        <h1 className="text-2xl font-bold tracking-tight">Leave config</h1>
        <p className="text-sm text-muted-foreground">
          Paid-leave allowance used to compute each employee&apos;s remaining balance —
          differentiated by employment type (full-time / part-time / intern).
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Current allowance</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !config ? (
            <p className="text-sm text-muted-foreground">
              No leave config exists yet{canEdit ? " — set one below." : "."}
            </p>
          ) : (
            <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">Full-time</dt>
                <dd className="font-medium">
                  {config.paidLeavesPerMonth}/mo · {config.paidLeavesPerYear}/yr
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Part-time</dt>
                <dd className="font-medium">
                  {config.partTimePaidLeavesPerMonth}/mo · {config.partTimePaidLeavesPerYear}/yr
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Intern</dt>
                <dd className="font-medium">
                  {config.internPaidLeavesPerMonth}/mo · {config.internPaidLeavesPerYear}/yr
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Effective from</dt>
                <dd className="font-medium">{formatDate(config.effectiveFrom)}</dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Set a new allowance</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              This inserts a new versioned allowance row — it never overwrites the current one, so
              a balance computed for a past period stays reproducible against the allowance in
              force at the time. Leave part-time/intern blank to default them to the full-time rate.
            </p>
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <div className="flex flex-wrap items-end gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="ft-month">Full-time / month</Label>
                  <Input
                    id="ft-month"
                    type="number"
                    min="0"
                    max="31"
                    step="1"
                    required
                    value={paidLeavesPerMonth}
                    onChange={(e) => {
                      const v = e.target.value;
                      setPaidLeavesPerMonth(v);
                      setPaidLeavesPerYear(v === "" ? "" : String(Number(v) * 12));
                    }}
                    className="w-32"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="ft-year">Full-time / year</Label>
                  <Input
                    id="ft-year"
                    type="number"
                    min="0"
                    max="366"
                    step="1"
                    required
                    value={paidLeavesPerYear}
                    onChange={(e) => setPaidLeavesPerYear(e.target.value)}
                    className="w-32"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="pt-month">Part-time / month</Label>
                  <Input
                    id="pt-month"
                    type="number"
                    min="0"
                    max="31"
                    step="1"
                    value={partTimePerMonth}
                    onChange={(e) => {
                      const v = e.target.value;
                      setPartTimePerMonth(v);
                      setPartTimePerYear(v === "" ? "" : String(Number(v) * 12));
                    }}
                    className="w-32"
                    placeholder={paidLeavesPerMonth}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="pt-year">Part-time / year</Label>
                  <Input
                    id="pt-year"
                    type="number"
                    min="0"
                    max="366"
                    step="1"
                    value={partTimePerYear}
                    onChange={(e) => setPartTimePerYear(e.target.value)}
                    className="w-32"
                    placeholder={paidLeavesPerYear}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="intern-month">Intern / month</Label>
                  <Input
                    id="intern-month"
                    type="number"
                    min="0"
                    max="31"
                    step="1"
                    value={internPerMonth}
                    onChange={(e) => {
                      const v = e.target.value;
                      setInternPerMonth(v);
                      setInternPerYear(v === "" ? "" : String(Number(v) * 12));
                    }}
                    className="w-32"
                    placeholder={paidLeavesPerMonth}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="intern-year">Intern / year</Label>
                  <Input
                    id="intern-year"
                    type="number"
                    min="0"
                    max="366"
                    step="1"
                    value={internPerYear}
                    onChange={(e) => setInternPerYear(e.target.value)}
                    className="w-32"
                    placeholder={paidLeavesPerYear}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="effective">Effective from</Label>
                  <DatePicker id="effective" required value={effectiveFrom} onChange={setEffectiveFrom} className="w-40" />
                </div>
              </div>
              {saveError && <p className="text-sm text-destructive">{saveError}</p>}
              <div>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Saving…" : "Save new allowance"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
