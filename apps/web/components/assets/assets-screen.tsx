"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/components/_lib/api";

type Asset = { id: string; name?: string };

export function AssetsScreen() {
  const [assets, setAssets] = useState<Asset[]>([]);

  useEffect(() => {
    apiFetch<Asset[]>("/assets").then((r) => r.data && setAssets(r.data));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Assets</h1>
        <p className="text-sm text-muted-foreground">
          Asset management is deferred to a later phase (PRD §5.12). This is a placeholder.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Tracked assets</CardTitle>
        </CardHeader>
        <CardContent>
          {assets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No assets tracked yet — this module will be built when the company has hardware to
              track.
            </p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {assets.map((a) => (
                <li key={a.id} className="rounded border p-2">
                  {a.name ?? a.id}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
