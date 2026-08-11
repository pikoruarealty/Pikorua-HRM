"use client";

import {
  COMPONENT_DESCRIPTIONS,
  COMPONENT_LABELS,
  type ComponentKey,
} from "@/lib/performance/composite";

// Pillar 6 — explains a composite monthly score. A rank nobody can interpret
// is just a number to argue about, so every row shows what it measured, the
// evidence behind it, and how much it counted toward the total.

export type ScoreComponent = {
  key: ComponentKey;
  label: string;
  weight: number;
  nominalWeight: number;
  value: number;
  detail: string | null;
  /** Profile-specific wording (Tech vs Sales). Absent on snapshots stored
   *  before 2026-08-11 — those fall back to the default description table. */
  description?: string;
};

export type ScoreComponents = {
  score: number;
  components: ScoreComponent[];
  unavailable: ComponentKey[];
  /** Components this department's profile gives weight 0 — see composite.ts. */
  inert?: ComponentKey[];
};

function barColor(value: number): string {
  if (value >= 80) return "bg-emerald-500";
  if (value >= 55) return "bg-amber-500";
  return "bg-destructive";
}

export function ScoreBreakdown({ data }: { data: ScoreComponents }) {
  if (data.components.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No measurable activity this period.
      </p>
    );
  }

  // A component is only worth explaining as "reweighted" if it was actually
  // dropped for lack of data. A slot this department's profile weights at 0
  // (the CRM slot in Tech, timeliness in Sales) was never going to count and
  // isn't news to anyone. Snapshots stored before 2026-08-11 carry no `inert`
  // list, so fall back to the only 0-weight slot that existed then.
  const inert = data.inert ?? ["salesOutcome"];
  const dropped = data.unavailable.filter((k) => !inert.includes(k));

  return (
    <div className="flex flex-col gap-3">
      {data.components.map((c) => (
        <div key={c.key} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium">
              {c.label}{" "}
              <span className="font-normal text-muted-foreground">
                · {c.weight}% of score
              </span>
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {c.detail ? `${c.detail} · ` : ""}
              <strong className="text-foreground">{c.value}</strong>/100
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${barColor(c.value)}`}
              style={{ width: `${Math.max(c.value, 1)}%` }}
            />
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            {c.description ?? COMPONENT_DESCRIPTIONS[c.key]}
          </p>
        </div>
      ))}
      {dropped.length > 0 && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          Not measurable this period, so the remaining weights were scaled up to
          cover it: {dropped.map((k) => COMPONENT_LABELS[k]).join(", ")}.
        </p>
      )}
    </div>
  );
}
