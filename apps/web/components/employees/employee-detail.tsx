"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmployeeAttendancePanel } from "@/components/attendance/employee-attendance-panel";

type Employee = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: string;
  departmentId: string | null;
  teamId: string | null;
  status: "active" | "inactive";
  dateOfJoining: string;
  deviceUid: number | null;
  baseSalary?: string;
};

type Department = { id: string; name: string };
type Team = { id: string; name: string; departmentId: string };

async function getJson(res: Response) {
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data;
}

export function EmployeeDetail({
  employeeId,
  canManage,
  isAdmin,
  canViewAttendance,
}: {
  employeeId: string;
  canManage: boolean;
  isAdmin: boolean;
  canViewAttendance: boolean;
}) {
  const router = useRouter();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [departmentId, setDepartmentId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [baseSalary, setBaseSalary] = useState("");
  const [deviceUid, setDeviceUid] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [emp, deptData, teamData] = await Promise.all([
        getJson(await fetch(`/api/v1/employees/${employeeId}`)),
        canManage ? getJson(await fetch("/api/v1/departments")) : Promise.resolve([]),
        canManage ? getJson(await fetch("/api/v1/teams")) : Promise.resolve([]),
      ]);
      setEmployee(emp);
      setDepartments(deptData);
      setTeams(teamData);
      setDepartmentId(emp.departmentId ?? "");
      setTeamId(emp.teamId ?? "");
      setBaseSalary(emp.baseSalary ?? "");
      setDeviceUid(emp.deviceUid?.toString() ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load employee.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await getJson(
        await fetch(`/api/v1/employees/${employeeId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            department_id: departmentId || null,
            team_id: teamId || null,
            base_salary: Number(baseSalary),
            device_uid: deviceUid ? Number(deviceUid) : null,
          }),
        }),
      );
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function onDeactivate() {
    if (!confirm("Deactivate this employee? This soft-deletes the record (status → inactive).")) {
      return;
    }
    await getJson(await fetch(`/api/v1/employees/${employeeId}`, { method: "DELETE" }));
    load();
  }

  async function onReactivate() {
    if (!confirm("Reactivate this employee? Status will be set back to active.")) {
      return;
    }
    await getJson(
      await fetch(`/api/v1/employees/${employeeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      }),
    );
    load();
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error && !employee) return <p className="text-sm text-destructive">{error}</p>;
  if (!employee) return null;

  const teamsInDepartment = teams.filter((t) => t.departmentId === departmentId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{employee.fullName}</h1>
          <p className="text-sm text-muted-foreground">{employee.email}</p>
        </div>
        <Badge variant={employee.status === "active" ? "default" : "secondary"}>
          {employee.status}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <span className="text-muted-foreground">Role: </span>
            {employee.role}
          </div>
          <div>
            <span className="text-muted-foreground">Phone: </span>
            {employee.phone ?? "—"}
          </div>
          <div>
            <span className="text-muted-foreground">Date of joining: </span>
            {new Date(employee.dateOfJoining).toLocaleDateString()}
          </div>
          {canManage && (
            <div>
              <span className="text-muted-foreground">Base salary: </span>
              {employee.baseSalary}
            </div>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Edit</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSave} className="grid gap-4 sm:grid-cols-2">
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
              <div className="flex flex-col gap-2">
                <Label htmlFor="device_uid">Device UID</Label>
                <Input
                  id="device_uid"
                  type="number"
                  value={deviceUid}
                  onChange={(e) => setDeviceUid(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
              <Button type="submit" disabled={saving} className="sm:col-span-2">
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {canViewAttendance && <EmployeeAttendancePanel employeeId={employeeId} />}

      <div className="flex gap-3">
        {isAdmin && employee.status === "active" && (
          <Button variant="destructive" onClick={onDeactivate} className="w-fit">
            Deactivate employee
          </Button>
        )}
        {/* Reactivation uses PATCH (status field), which is FINANCE_ROLES-gated
            on the API side, same as the rest of the edit form above — not
            Admin-only like deactivation (DELETE), so canManage is the right check. */}
        {canManage && employee.status === "inactive" && (
          <Button onClick={onReactivate} className="w-fit">
            Reactivate employee
          </Button>
        )}
      </div>

      <Button variant="outline" className="w-fit" onClick={() => router.push("/employees")}>
        Back to list
      </Button>
    </div>
  );
}
