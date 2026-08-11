"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format-date";

async function getJson(res: Response) {
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data;
}

type SalesTargetConfig = {
  dailyCallTarget: number;
  monthlySiteVisitTarget: number;
  monthlyBookingTarget: number;
  autoAssignDailyCalls: boolean;
  effectiveFrom?: string;
};

type PerformanceConfig = {
  scoringEnabled: boolean;
  selfLoggedCapPercent: number;
  effectiveFrom?: string;
};

type AdhocTaskType = {
  id: string;
  key: string;
  label: string;
  points: number;
  active: boolean;
  sortOrder: number;
};

function SalesTargetCard({ canEdit }: { canEdit: boolean }) {
  const [config, setConfig] = useState<SalesTargetConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dailyCallTarget, setDailyCallTarget] = useState("100");
  const [monthlySiteVisitTarget, setMonthlySiteVisitTarget] = useState("20");
  const [monthlyBookingTarget, setMonthlyBookingTarget] = useState("2");
  const [autoAssignDailyCalls, setAutoAssignDailyCalls] = useState(true);
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await getJson(await fetch("/api/v1/sales/target-config"));
      setConfig(data);
      setDailyCallTarget(String(data.dailyCallTarget));
      setMonthlySiteVisitTarget(String(data.monthlySiteVisitTarget));
      setMonthlyBookingTarget(String(data.monthlyBookingTarget));
      setAutoAssignDailyCalls(data.autoAssignDailyCalls);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sales target config.");
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
        await fetch("/api/v1/sales/target-config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            daily_call_target: dailyCallTarget,
            monthly_site_visit_target: monthlySiteVisitTarget,
            monthly_booking_target: monthlyBookingTarget,
            auto_assign_daily_calls: autoAssignDailyCalls,
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
    <Card>
      <CardHeader>
        <CardTitle>Sales targets (org default)</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Applies to every sales/BD employee unless a Lead sets a per-employee override on their
          profile. Attainment is paced against days a rep was actually expected to be selling —
          weekly offs, holidays and approved leave come out of the denominator.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Daily calls</dt>
              <dd className="font-medium">{config?.dailyCallTarget}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Monthly site visits</dt>
              <dd className="font-medium">{config?.monthlySiteVisitTarget}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Monthly bookings</dt>
              <dd className="font-medium">{config?.monthlyBookingTarget}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Auto-assign daily calls task</dt>
              <dd className="font-medium">{config?.autoAssignDailyCalls ? "Yes" : "No"}</dd>
            </div>
          </dl>
        )}

        {canEdit && (
          <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-4 border-t pt-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="calls">Daily calls</Label>
              <Input
                id="calls"
                type="number"
                min="1"
                required
                value={dailyCallTarget}
                onChange={(e) => setDailyCallTarget(e.target.value)}
                className="w-32"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="visits">Monthly site visits</Label>
              <Input
                id="visits"
                type="number"
                min="0"
                required
                value={monthlySiteVisitTarget}
                onChange={(e) => setMonthlySiteVisitTarget(e.target.value)}
                className="w-32"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="bookings">Monthly bookings</Label>
              <Input
                id="bookings"
                type="number"
                min="0"
                required
                value={monthlyBookingTarget}
                onChange={(e) => setMonthlyBookingTarget(e.target.value)}
                className="w-32"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoAssignDailyCalls}
                onChange={(e) => setAutoAssignDailyCalls(e.target.checked)}
              />
              Auto-assign daily calls task
            </label>
            <div className="flex flex-col gap-2">
              <Label htmlFor="sales-effective">Effective from</Label>
              <DatePicker
                id="sales-effective"
                required
                value={effectiveFrom}
                onChange={setEffectiveFrom}
                className="w-40"
              />
            </div>
            {saveError && <p className="w-full text-sm text-destructive">{saveError}</p>}
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Save new targets"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function PerformanceConfigCard({ canEdit }: { canEdit: boolean }) {
  const [config, setConfig] = useState<PerformanceConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [scoringEnabled, setScoringEnabled] = useState(false);
  const [selfLoggedCapPercent, setSelfLoggedCapPercent] = useState("30");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await getJson(await fetch("/api/v1/performance/config"));
      setConfig(data);
      setScoringEnabled(data.scoringEnabled);
      setSelfLoggedCapPercent(String(data.selfLoggedCapPercent));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load performance config.");
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
        await fetch("/api/v1/performance/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scoring_enabled: scoringEnabled,
            self_logged_cap_percent: selfLoggedCapPercent,
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
    <Card>
      <CardHeader>
        <CardTitle>Monthly performance scoring</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          While scoring is off, tasks and attendance are still recorded but no composite score is
          published or shown on Recognition — turn it on once a full month of clean data exists.
          Weekly recognition is never gated by this switch.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Monthly scoring</dt>
              <dd className="font-medium">
                <Badge variant={config?.scoringEnabled ? "default" : "secondary"}>
                  {config?.scoringEnabled ? "Enabled" : "Disabled"}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Self-logged cap</dt>
              <dd className="font-medium">{config?.selfLoggedCapPercent}% of monthly points</dd>
            </div>
          </dl>
        )}

        {canEdit && (
          <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-4 border-t pt-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={scoringEnabled}
                onChange={(e) => setScoringEnabled(e.target.checked)}
              />
              Publish monthly composite scores
            </label>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cap">Self-logged cap (%)</Label>
              <Input
                id="cap"
                type="number"
                min="0"
                max="100"
                required
                value={selfLoggedCapPercent}
                onChange={(e) => setSelfLoggedCapPercent(e.target.value)}
                className="w-32"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="perf-effective">Effective from</Label>
              <DatePicker
                id="perf-effective"
                required
                value={effectiveFrom}
                onChange={setEffectiveFrom}
                className="w-40"
              />
            </div>
            {saveError && <p className="w-full text-sm text-destructive">{saveError}</p>}
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Save"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function AdhocCatalogCard({ canEdit }: { canEdit: boolean }) {
  const [types, setTypes] = useState<AdhocTaskType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [points, setPoints] = useState("1");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await getJson(await fetch("/api/v1/adhoc-task-types?includeInactive=1"));
      setTypes(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load ad-hoc task catalog.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await getJson(
        await fetch("/api/v1/adhoc-task-types", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, label, points: Number(points) }),
        }),
      );
      setKey("");
      setLabel("");
      setPoints("1");
      await load();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Failed to create.");
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(type: AdhocTaskType) {
    setBusyId(type.id);
    try {
      await getJson(
        await fetch(`/api/v1/adhoc-task-types/${type.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active: !type.active }),
        }),
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update.");
    } finally {
      setBusyId(null);
    }
  }

  async function updatePoints(type: AdhocTaskType, next: string) {
    const parsed = Number(next);
    if (!Number.isInteger(parsed) || parsed < 1) return;
    setBusyId(type.id);
    try {
      await getJson(
        await fetch(`/api/v1/adhoc-task-types/${type.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ points: parsed }),
        }),
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Self-logged task catalog</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          The fixed price list a tech employee picks from when logging their own work with no
          assigned task. Nobody judges difficulty at review time — the type sets the points, the
          Lead only confirms the work happened.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Points</TableHead>
                <TableHead>Status</TableHead>
                {canEdit && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {types.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-xs">{t.key}</TableCell>
                  <TableCell>{t.label}</TableCell>
                  <TableCell>
                    {canEdit ? (
                      <Input
                        type="number"
                        min="1"
                        max="100"
                        defaultValue={t.points}
                        disabled={busyId === t.id}
                        onBlur={(e) => {
                          if (e.target.value !== String(t.points)) updatePoints(t, e.target.value);
                        }}
                        className="w-20"
                      />
                    ) : (
                      t.points
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={t.active ? "default" : "secondary"}>
                      {t.active ? "Active" : "Retired"}
                    </Badge>
                  </TableCell>
                  {canEdit && (
                    <TableCell>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busyId === t.id}
                        onClick={() => toggleActive(t)}
                      >
                        {t.active ? "Retire" : "Reactivate"}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {canEdit && (
          <form onSubmit={onCreate} className="flex flex-wrap items-end gap-4 border-t pt-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="key">Key (snake_case, immutable)</Label>
              <Input
                id="key"
                required
                pattern="[a-z][a-z0-9_]*"
                placeholder="small_feature"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                className="w-48"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="label">Label</Label>
              <Input
                id="label"
                required
                placeholder="Small feature"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="w-48"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-points">Points</Label>
              <Input
                id="new-points"
                type="number"
                min="1"
                max="100"
                required
                value={points}
                onChange={(e) => setPoints(e.target.value)}
                className="w-24"
              />
            </div>
            {createError && <p className="w-full text-sm text-destructive">{createError}</p>}
            <Button type="submit" disabled={creating}>
              {creating ? "Adding…" : "Add type"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export function ScoringConfigScreen({ canEdit }: { canEdit: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Scoring &amp; targets</h1>
        <p className="text-sm text-muted-foreground">
          Org-wide defaults behind sales targets, the monthly performance score, and the
          self-logged ad-hoc task catalog. Every edit here inserts a new versioned row rather than
          overwriting the current one, so a period already scored stays reproducible against the
          settings that were actually in force.
        </p>
      </div>
      <SalesTargetCard canEdit={canEdit} />
      <PerformanceConfigCard canEdit={canEdit} />
      <AdhocCatalogCard canEdit={canEdit} />
    </div>
  );
}
