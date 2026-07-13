"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ROLES = [
  "admin",
  "hr",
  "tech_lead",
  "sales_lead",
  "tech_employee",
  "sales_employee",
  "bde",
];

type Department = { id: string; name: string };
type Team = { id: string; name: string; departmentId: string };

async function getJson(res: Response) {
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data;
}

export function EmployeeCreateForm() {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("tech_employee");
  const [departmentId, setDepartmentId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [dateOfJoining, setDateOfJoining] = useState("");
  const [baseSalary, setBaseSalary] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ temporaryPassword?: string } | null>(null);

  useEffect(() => {
    (async () => {
      const [deptData, teamData] = await Promise.all([
        getJson(await fetch("/api/v1/departments")),
        getJson(await fetch("/api/v1/teams")),
      ]);
      setDepartments(deptData);
      setTeams(teamData);
    })();
  }, []);

  const teamsInDepartment = teams.filter((t) => t.departmentId === departmentId);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const data = await getJson(
        await fetch("/api/v1/employees", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            full_name: fullName,
            email,
            phone: phone || undefined,
            role,
            department_id: departmentId || undefined,
            team_id: teamId || undefined,
            date_of_joining: dateOfJoining,
            base_salary: Number(baseSalary),
          }),
        }),
      );
      if (data.temporaryPassword) {
        setResult({ temporaryPassword: data.temporaryPassword });
      } else {
        router.push(`/employees/${data.id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create employee.");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Employee created</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm">
            Share this temporary password with the new employee out-of-band — it will
            not be shown again.
          </p>
          <code className="rounded bg-muted px-3 py-2 text-sm">
            {result.temporaryPassword}
          </code>
          <Button onClick={() => router.push("/employees")}>Back to employees</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New employee</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="full_name">Full name</Label>
            <Input id="full_name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="role">Role</Label>
            <select
              id="role"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="department_id">Department</Label>
            <select
              id="department_id"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={departmentId}
              onChange={(e) => {
                setDepartmentId(e.target.value);
                setTeamId("");
              }}
            >
              <option value="">— none —</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="team_id">Team</Label>
            <select
              id="team_id"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              disabled={!departmentId}
            >
              <option value="">— none —</option>
              {teamsInDepartment.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="date_of_joining">Date of joining</Label>
            <Input
              id="date_of_joining"
              type="date"
              value={dateOfJoining}
              onChange={(e) => setDateOfJoining(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="base_salary">Base salary</Label>
            <Input
              id="base_salary"
              type="number"
              min="0"
              step="0.01"
              value={baseSalary}
              onChange={(e) => setBaseSalary(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
          <Button type="submit" disabled={submitting} className="sm:col-span-2">
            {submitting ? "Creating…" : "Create employee"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
