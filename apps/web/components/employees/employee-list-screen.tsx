"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmployeeAvatar } from "@/components/employees/employee-avatar";

type Employee = {
  id: string;
  fullName: string;
  photoUrl: string | null;
  email: string;
  role: string;
  departmentId: string | null;
  teamId: string | null;
  status: "active" | "inactive";
  baseSalary?: string;
};

async function getJson(res: Response) {
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data;
}

export function EmployeeListScreen({ canManage }: { canManage: boolean }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const data = await getJson(await fetch("/api/v1/employees"));
        setEmployees(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load employees.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      (e) => e.fullName.toLowerCase().includes(q) || e.email.toLowerCase().includes(q),
    );
  }, [employees, search]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Employees</h1>
          <p className="text-sm text-muted-foreground">
            {canManage ? "All employees." : "Your team."}
          </p>
        </div>
        {canManage && (
          <Link href="/employees/new" className={buttonVariants()}>
            New employee
          </Link>
        )}
      </div>

      <Input
        placeholder="Search by name or email…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>{filtered.length} employee(s)</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  {canManage && <TableHead>Base salary</TableHead>}
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <EmployeeAvatar fullName={e.fullName} photoUrl={e.photoUrl} size="sm" />
                        {e.fullName}
                      </span>
                    </TableCell>
                    <TableCell>{e.email}</TableCell>
                    <TableCell>{e.role}</TableCell>
                    <TableCell>
                      <Badge variant={e.status === "active" ? "default" : "secondary"}>
                        {e.status}
                      </Badge>
                    </TableCell>
                    {canManage && <TableCell>{e.baseSalary ?? "—"}</TableCell>}
                    <TableCell>
                      <Link
                        href={`/employees/${e.id}`}
                        className="text-sm font-medium text-primary hover:underline"
                      >
                        View
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
