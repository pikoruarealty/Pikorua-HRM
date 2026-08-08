"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/components/_lib/api";
import { RATING_LABELS } from "@/lib/performance/review";

// Read-only monthly review history for one employee (Pillar 3, 2026-08-08).
// Data from GET /api/v1/employees/:id/performance-review, which allows self,
// the owning Lead, and Admin/HR — the same set the panel is rendered for.
//
// Read-only on purpose: entering and correcting reviews happens on
// /performance/review, so an employee looking at their own profile sees the
// rating and the note and nothing to act on.

type Review = {
  id: string;
  periodLabel: string;
  rating: number;
  note: string | null;
  reviewer: { id: string; fullName: string };
  canEdit: boolean;
  updatedAt: string;
};

type Payload = {
  summary: { reviewCount: number; averageRating: number | null; latestRating: number | null };
  reviews: Review[];
};

function ratingVariant(rating: number): "success" | "secondary" | "warning" | "destructive" {
  if (rating >= 4) return "success";
  if (rating === 3) return "secondary";
  if (rating === 2) return "warning";
  return "destructive";
}

export function EmployeePerformanceReviewPanel({ employeeId }: { employeeId: string }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Payload>(`/employees/${employeeId}/performance-review`).then((r) => {
      if (r.error) setError(`${r.error.code}: ${r.error.message}`);
      else setPayload(r.data);
    });
  }, [employeeId]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">Monthly reviews</CardTitle>
        {payload && payload.summary.averageRating !== null && (
          <span className="text-xs text-muted-foreground">
            Average {payload.summary.averageRating} / 5 across {payload.summary.reviewCount}{" "}
            {payload.summary.reviewCount === 1 ? "month" : "months"}
          </span>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!payload && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
        {payload?.reviews.length === 0 && (
          <p className="text-sm text-muted-foreground">No reviews recorded yet.</p>
        )}
        {payload?.reviews.map((r) => (
          <div key={r.id} className="flex flex-wrap items-start gap-3 rounded-lg border p-3">
            <Badge variant={ratingVariant(r.rating)}>{r.rating} / 5</Badge>
            <div className="min-w-[12rem] flex-1">
              <p className="text-sm font-medium">
                {r.periodLabel} — {RATING_LABELS[r.rating]}
              </p>
              <p className="text-xs text-muted-foreground">Reviewed by {r.reviewer.fullName}</p>
              {r.note && <p className="mt-1 whitespace-pre-wrap text-sm">{r.note}</p>}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
