"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { apiFetch } from "./_lib/api";

export default function TestHome() {
  const [me, setMe] = useState<unknown>(null);

  useEffect(() => {
    apiFetch("/auth/me").then((res) => setMe(res.data ?? res.error));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Track B test harness</h1>
        <p className="text-muted-foreground text-sm">
          Basic UI for manually exercising Milestone 1-2 routes. Not the final design.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Current session (GET /auth/me)</CardTitle>
          <CardDescription>Confirms which user/role/employee you&apos;re testing as.</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-auto rounded bg-muted p-3 text-xs">{JSON.stringify(me, null, 2)}</pre>
        </CardContent>
      </Card>
    </div>
  );
}
