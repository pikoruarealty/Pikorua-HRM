"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

type Department = { id: string; name: string };
type Team = { id: string; name: string; departmentId: string };

const ROLES = [
  "admin",
  "hr",
  "tech_lead",
  "sales_lead",
  "tech_employee",
  "sales_employee",
  "bde",
];

const ALL = "__all__";

function humanizeRole(role: string) {
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

async function getJson(res: Response) {
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data;
}

export function EmployeeListScreen({ canManage }: { canManage: boolean }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [roleFilter, setRoleFilter] = useState<string>(ALL);
  const [departmentFilter, setDepartmentFilter] = useState<string>(ALL);
  const [teamFilter, setTeamFilter] = useState<string>(ALL);

  useEffect(() => {
    (async () => {
      try {
        const [emp, dept, team] = await Promise.all([
          getJson(await fetch("/api/v1/employees")),
          getJson(await fetch("/api/v1/departments")).catch(() => []),
          getJson(await fetch("/api/v1/teams")).catch(() => []),
        ]);
        setEmployees(emp);
        setDepartments(dept);
        setTeams(team);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load employees.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Teams selectable in the team filter narrow to the chosen department.
  const teamsForFilter = useMemo(
    () =>
      departmentFilter === ALL
        ? teams
        : teams.filter((t) => t.departmentId === departmentFilter),
    [teams, departmentFilter],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((e) => {
      if (q && !e.fullName.toLowerCase().includes(q) && !e.email.toLowerCase().includes(q)) {
        return false;
      }
      if (statusFilter !== ALL && e.status !== statusFilter) return false;
      if (roleFilter !== ALL && e.role !== roleFilter) return false;
      if (departmentFilter !== ALL && e.departmentId !== departmentFilter) return false;
      if (teamFilter !== ALL && e.teamId !== teamFilter) return false;
      return true;
    });
  }, [employees, search, statusFilter, roleFilter, departmentFilter, teamFilter]);

  const anyFilterActive =
    search.trim() !== "" ||
    statusFilter !== ALL ||
    roleFilter !== ALL ||
    departmentFilter !== ALL ||
    teamFilter !== ALL;

  function resetFilters() {
    setSearch("");
    setStatusFilter(ALL);
    setRoleFilter(ALL);
    setDepartmentFilter(ALL);
    setTeamFilter(ALL);
  }

  const deptName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? "—";
  const teamName = (id: string | null) => teams.find((t) => t.id === id)?.name ?? "—";

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

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Search</label>
              <Input
                placeholder="Name or email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {canManage && (
              <>
                <FilterSelect
                  label="Status"
                  value={statusFilter}
                  onChange={setStatusFilter}
                  options={[
                    { value: ALL, label: "All statuses" },
                    { value: "active", label: "Active" },
                    { value: "inactive", label: "Inactive" },
                  ]}
                />
                <FilterSelect
                  label="Role"
                  value={roleFilter}
                  onChange={setRoleFilter}
                  options={[
                    { value: ALL, label: "All roles" },
                    ...ROLES.map((r) => ({ value: r, label: humanizeRole(r) })),
                  ]}
                />
                <FilterSelect
                  label="Department"
                  value={departmentFilter}
                  onChange={(v) => {
                    setDepartmentFilter(v);
                    setTeamFilter(ALL);
                  }}
                  options={[
                    { value: ALL, label: "All departments" },
                    ...departments.map((d) => ({ value: d.id, label: d.name })),
                  ]}
                />
                <FilterSelect
                  label="Team"
                  value={teamFilter}
                  onChange={setTeamFilter}
                  options={[
                    { value: ALL, label: "All teams" },
                    ...teamsForFilter.map((t) => ({ value: t.id, label: t.name })),
                  ]}
                />
              </>
            )}

            {anyFilterActive && (
              <button
                type="button"
                onClick={resetFilters}
                className="h-9 text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>
            {filtered.length} employee{filtered.length === 1 ? "" : "s"}
            {anyFilterActive && employees.length !== filtered.length && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                of {employees.length}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">No employees match these filters.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  {canManage && <TableHead>Department</TableHead>}
                  {canManage && <TableHead>Team</TableHead>}
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
                    <TableCell>{humanizeRole(e.role)}</TableCell>
                    {canManage && <TableCell>{deptName(e.departmentId)}</TableCell>}
                    {canManage && <TableCell>{teamName(e.teamId)}</TableCell>}
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

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex min-w-[150px] flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
