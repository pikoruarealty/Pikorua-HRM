"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "../_lib/api";

type WorkUnit = {
  id: string;
  name: string;
  status: string;
  departmentId: string;
  teamLeadId?: string;
};

export default function WorkUnitsPage() {
  const [workUnits, setWorkUnits] = useState<WorkUnit[]>([]);
  const [name, setName] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [teamLeadId, setTeamLeadId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    const res = await apiFetch<WorkUnit[]>("/work-units");
    if (res.data) setWorkUnits(res.data);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await apiFetch("/work-units", {
      method: "POST",
      body: JSON.stringify({
        name,
        departmentId,
        teamLeadId: teamLeadId || undefined,
      }),
    });
    setLoading(false);
    if (res.error) {
      setError(`${res.error.code}: ${res.error.message}`);
      return;
    }
    setName("");
    setTeamLeadId("");
    refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Create WorkUnit (POST /work-units)</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Department ID (UUID)</Label>
              <Input value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label>Team Lead ID (UUID, optional — Leads default to self)</Label>
              <Input value={teamLeadId} onChange={(e) => setTeamLeadId(e.target.value)} />
            </div>
            {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
            <Button type="submit" disabled={loading} className="sm:col-span-2 w-fit">
              {loading ? "Creating..." : "Create"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>WorkUnits (GET /work-units)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {workUnits.length === 0 && <p className="text-sm text-muted-foreground">None visible to your role yet.</p>}
          {workUnits.map((wu) => (
            <Link
              key={wu.id}
              href={`/test/work-units/${wu.id}`}
              className="flex items-center justify-between rounded border p-3 text-sm hover:bg-muted/50"
            >
              <span>{wu.name}</span>
              <Badge variant="outline">{wu.status}</Badge>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
