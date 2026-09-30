"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

// Admin's per-employee work-from-home controls (2026-09-30): an on/off switch
// (saves the moment it's flipped, so it can be changed whenever) and, for
// part-time / intern staff, a weekly WFH-hours target. Two compact cells meant to
// sit in the profile's Details grid; non-Admins just see the values.

type Props = {
  employeeId: string;
  wfhAllowed: boolean;
  isFlexible: boolean;
  expectedWfhHoursPerWeek: string | null;
  isAdmin: boolean;
  onChanged: () => void;
};

export function EmployeeWfhControls({
  employeeId,
  wfhAllowed,
  isFlexible,
  expectedWfhHoursPerWeek,
  isAdmin,
  onChanged,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hours, setHours] = useState(expectedWfhHoursPerWeek ? String(Number(expectedWfhHoursPerWeek)) : "");

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/employees/${employeeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  function saveHours() {
    const current = expectedWfhHoursPerWeek ? String(Number(expectedWfhHoursPerWeek)) : "";
    if (hours.trim() === current) return;
    const n = hours.trim() === "" ? null : Number(hours);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 80)) {
      setError("Enter 0–80 hours.");
      return;
    }
    patch({ expected_wfh_hours_per_week: n });
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Work from home: </span>
        {isAdmin ? (
          <>
            <Switch
              checked={wfhAllowed}
              disabled={busy}
              onCheckedChange={(v) => patch({ wfh_allowed: v })}
              aria-label="Allow work from home"
            />
            <span className="text-xs text-muted-foreground">{wfhAllowed ? "Allowed" : "Off"}</span>
          </>
        ) : (
          <span>{wfhAllowed ? "Allowed" : "Off"}</span>
        )}
      </div>
      {isFlexible && (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">WFH target: </span>
          {isAdmin ? (
            <>
              <Input
                type="number"
                min="0"
                max="80"
                step="0.5"
                inputMode="decimal"
                placeholder="—"
                value={hours}
                disabled={busy}
                onChange={(e) => setHours(e.target.value)}
                onBlur={saveHours}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                className="h-8 w-20"
                aria-label="Expected WFH hours per week"
              />
              <span className="text-xs text-muted-foreground">h / week</span>
            </>
          ) : (
            <span>{expectedWfhHoursPerWeek ? `${Number(expectedWfhHoursPerWeek)} h / week` : "—"}</span>
          )}
        </div>
      )}
      {error && <p className="text-xs text-destructive sm:col-span-2">{error}</p>}
    </>
  );
}
