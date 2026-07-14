"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "../_lib/api";

type Asset = { id: string; name?: string };

// Assets are an explicitly-deferred stub (PRD §5.12) — this page just proves
// the reserved endpoint returns a valid empty envelope and is Admin/HR-gated.
export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Asset[]>("/assets").then((res) => {
      if (res.error) setError(`${res.error.code}: ${res.error.message}`);
      else setAssets(res.data ?? []);
    });
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Assets (GET /assets) — deferred stub</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p className="text-muted-foreground">
            Real asset management is out of scope for v1 (PRD §5.12). This
            endpoint is a placeholder that returns an empty list and is
            Admin/HR-only — a non-finance role should see a FORBIDDEN error here.
          </p>
          {error && <p className="text-destructive">{error}</p>}
          {assets !== null && !error && (
            <p className="text-muted-foreground">
              Returned {assets.length} asset(s){assets.length === 0 ? " (expected — empty stub)." : "."}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
