"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmployeeAttendancePanel } from "@/components/attendance/employee-attendance-panel";
import { EmployeeWorkPanel } from "@/components/employees/employee-work-panel";
import { EmployeeTaskActivityPanel } from "@/components/employees/employee-task-activity-panel";
import { EmployeeAvatar } from "@/components/employees/employee-avatar";
import { EmployeeEventsPanel } from "@/components/employees/employee-events-panel";
import { EmployeeLeaveBalancePanel } from "@/components/employees/employee-leave-balance-panel";
import { formatDate } from "@/lib/format-date";
import { ImageCropModal, isSquare } from "@/components/employees/image-cropper";
import {
  EmployeeRequestsPanel,
  EmployeePayslipsPanel,
} from "@/components/employees/employee-profile-panels";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Employee = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: string;
  employmentType?: "fulltime" | "parttime" | "intern";
  requiredDaysPerWeek?: number | null;
  defaultWeeklyOffDay?: number | null;
  departmentId: string | null;
  teamId: string | null;
  status: "active" | "inactive";
  dateOfBirth: string | null;
  dateOfJoining: string;
  deviceUid: number | null;
  photoUrl: string | null;
  createdAt: string;
  baseSalary?: string;
};

type Department = { id: string; name: string };
type Team = { id: string; name: string; departmentId: string; defaultWeeklyOffDay?: number };

const ROLES = [
  "admin",
  "hr",
  "tech_lead",
  "sales_lead",
  "tech_employee",
  "sales_employee",
  "bde",
];

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function humanizeRole(role: string) {
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function humanizeEmploymentType(type?: string) {
  if (type === "parttime") return "Part-time";
  if (type === "intern") return "Intern";
  return "Full-time";
}

class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function getJson(res: Response) {
  const json = await res.json();
  if (json.error) throw new ApiError(json.error.code, json.error.message);
  return json.data;
}

export function EmployeeDetail({
  employeeId,
  canManage,
  isAdmin,
  canViewAttendance,
  isSelf,
}: {
  employeeId: string;
  canManage: boolean;
  isAdmin: boolean;
  canViewAttendance: boolean;
  isSelf: boolean;
}) {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<{ code: string; message: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const [departmentId, setDepartmentId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [baseSalary, setBaseSalary] = useState("");
  const [deviceUid, setDeviceUid] = useState("");
  const [role, setRole] = useState("");
  const [employmentType, setEmploymentType] = useState<"fulltime" | "parttime" | "intern">("fulltime");
  const [requiredDaysPerWeek, setRequiredDaysPerWeek] = useState("");
  const [defaultWeeklyOffDay, setDefaultWeeklyOffDay] = useState("__default__");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [dateOfJoining, setDateOfJoining] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [hardDeleteError, setHardDeleteError] = useState<string | null>(null);
  const [hardDeleting, setHardDeleting] = useState(false);
  const router = useRouter();

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      // Departments/teams are fetched for every viewer so the profile can
      // show names instead of ids (both endpoints are role-safe: departments
      // is Any, teams is server-scoped).
      const [emp, deptData, teamData] = await Promise.all([
        getJson(await fetch(`/api/v1/employees/${employeeId}`)),
        getJson(await fetch("/api/v1/departments")).catch(() => []),
        getJson(await fetch("/api/v1/teams")).catch(() => []),
      ]);
      setEmployee(emp);
      setDepartments(deptData);
      setTeams(teamData);
      setDepartmentId(emp.departmentId ?? "");
      setTeamId(emp.teamId ?? "");
      setBaseSalary(emp.baseSalary ?? "");
      setDeviceUid(emp.deviceUid?.toString() ?? "");
      setRole(emp.role);
      setEmploymentType(emp.employmentType ?? "fulltime");
      setRequiredDaysPerWeek(emp.requiredDaysPerWeek?.toString() ?? "");
      setDefaultWeeklyOffDay(emp.defaultWeeklyOffDay !== null && emp.defaultWeeklyOffDay !== undefined ? String(emp.defaultWeeklyOffDay) : "__default__");
      setFullName(emp.fullName);
      setEmail(emp.email);
      setPhone(emp.phone ?? "");
      setDateOfBirth(emp.dateOfBirth ? emp.dateOfBirth.slice(0, 10) : "");
      setDateOfJoining(emp.dateOfJoining.slice(0, 10));
    } catch (e) {
      setLoadError({
        code: e instanceof ApiError ? e.code : "INTERNAL",
        message: e instanceof Error ? e.message : "Failed to load employee.",
      });
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
    setNotice(null);
    // Only an admin may change role, and only send it when it actually changed
    // (a no-op role in the body would needlessly revoke the employee's session).
    const roleChanged = isAdmin && !isSelf && role !== employee?.role;
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
            employment_type: employmentType,
            required_days_per_week: employmentType !== "fulltime" && requiredDaysPerWeek ? Number(requiredDaysPerWeek) : null,
            default_weekly_off_day: defaultWeeklyOffDay !== "__default__" ? Number(defaultWeeklyOffDay) : null,
            full_name: fullName,
            email,
            phone: phone || null,
            date_of_birth: dateOfBirth || null,
            date_of_joining: dateOfJoining,
            ...(roleChanged ? { role } : {}),
          }),
        }),
      );
      if (roleChanged) {
        setNotice(
          "Role updated. The employee's active sessions were revoked — they must sign in again to get the new permissions.",
        );
      }
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

  async function onHardDelete() {
    if (
      !confirm(
        "Permanently delete this employee? This cannot be undone and only works if they have zero attendance/payslip/request/task history.",
      )
    ) {
      return;
    }
    setHardDeleting(true);
    setHardDeleteError(null);
    try {
      await getJson(await fetch(`/api/v1/employees/${employeeId}/hard-delete`, { method: "DELETE" }));
      router.push("/employees");
    } catch (e) {
      setHardDeleteError(e instanceof Error ? e.message : "Failed to permanently delete employee.");
    } finally {
      setHardDeleting(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (loadError && !employee) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <ShieldAlert className="size-7" />
        </span>
        <h1 className="text-lg font-semibold">
          {loadError.code === "FORBIDDEN" ? "You don't have access to this profile" : "Something went wrong"}
        </h1>
        <p className="max-w-sm text-sm text-muted-foreground">{loadError.message}</p>
        <Link href="/" className="mt-1 text-sm font-medium text-primary hover:underline">
          Back to dashboard
        </Link>
      </div>
    );
  }
  if (!employee) return null;

  const teamsInDepartment = teams.filter((t) => t.departmentId === departmentId);
  const employeeTeam = teams.find((t) => t.id === employee.teamId);
  const effectiveOffDay = employee.defaultWeeklyOffDay ?? employeeTeam?.defaultWeeklyOffDay ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/employees" className="text-sm text-muted-foreground hover:underline">
          ← Employees
        </Link>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <EmployeeAvatar fullName={employee.fullName} photoUrl={employee.photoUrl} size="lg" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{employee.fullName}</h1>
            <p className="text-sm text-muted-foreground">{employee.email}</p>
            {canManage && <PhotoReplaceControl employeeId={employee.id} onUploaded={load} />}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{humanizeEmploymentType(employee.employmentType)}</Badge>
          <Badge variant={employee.status === "active" ? "default" : "secondary"}>
            {employee.status}
          </Badge>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <span className="text-muted-foreground">Role: </span>
            {humanizeRole(employee.role)}
          </div>
          <div>
            <span className="text-muted-foreground">Employment type: </span>
            {humanizeEmploymentType(employee.employmentType)}
            {employee.employmentType !== "fulltime" && employee.requiredDaysPerWeek && (
              <span className="text-muted-foreground"> ({employee.requiredDaysPerWeek} days/wk)</span>
            )}
          </div>
          <div>
            <span className="text-muted-foreground">Weekly off day: </span>
            {DAY_NAMES[effectiveOffDay]}
            {employee.defaultWeeklyOffDay !== null && employee.defaultWeeklyOffDay !== undefined ? (
              <span className="text-xs text-muted-foreground"> (employee override)</span>
            ) : (
              <span className="text-xs text-muted-foreground"> (team default)</span>
            )}
          </div>
          <div>
            <span className="text-muted-foreground">Phone: </span>
            {employee.phone ?? "—"}
          </div>
          <div>
            <span className="text-muted-foreground">Date of birth: </span>
            {formatDate(employee.dateOfBirth)}
          </div>
          <div>
            <span className="text-muted-foreground">Date of joining: </span>
            {formatDate(employee.dateOfJoining)}
          </div>
          <div>
            <span className="text-muted-foreground">Department: </span>
            {departments.find((d) => d.id === employee.departmentId)?.name ?? "—"}
          </div>
          <div>
            <span className="text-muted-foreground">Team: </span>
            {teams.find((t) => t.id === employee.teamId)?.name ?? "—"}
          </div>
          <div>
            <span className="text-muted-foreground">On record since: </span>
            {formatDate(employee.createdAt)}
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
                <Label htmlFor="full_name">Full name</Label>
                <Input
                  id="full_name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Also updates their login email.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="date_of_birth">Date of birth</Label>
                <DatePicker id="date_of_birth" value={dateOfBirth} onChange={setDateOfBirth} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="date_of_joining">Date of joining</Label>
                <DatePicker id="date_of_joining" value={dateOfJoining} onChange={setDateOfJoining} required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="employment_type">Employment Type</Label>
                <Select
                  value={employmentType}
                  onValueChange={(v: "fulltime" | "parttime" | "intern") => {
                    setEmploymentType(v);
                    if (v !== "fulltime" && !requiredDaysPerWeek) {
                      setRequiredDaysPerWeek(v === "intern" ? "6" : "3");
                    }
                  }}
                >
                  <SelectTrigger id="employment_type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fulltime">Full-time</SelectItem>
                    <SelectItem value="parttime">Part-time</SelectItem>
                    <SelectItem value="intern">Intern</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {employmentType !== "fulltime" && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="required_days">Required Days / Week</Label>
                  <Input
                    id="required_days"
                    type="number"
                    min="1"
                    max="7"
                    value={requiredDaysPerWeek}
                    onChange={(e) => setRequiredDaysPerWeek(e.target.value)}
                    placeholder="e.g. 3"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Days required per week (resets weekly, flexible attendance).
                  </p>
                </div>
              )}
              <div className="flex flex-col gap-2">
                <Label htmlFor="default_weekly_off_day">Weekly Off Day (Override)</Label>
                <Select value={defaultWeeklyOffDay} onValueChange={setDefaultWeeklyOffDay}>
                  <SelectTrigger id="default_weekly_off_day">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">Default (from team / Sunday)</SelectItem>
                    <SelectItem value="0">Sunday</SelectItem>
                    <SelectItem value="1">Monday</SelectItem>
                    <SelectItem value="2">Tuesday</SelectItem>
                    <SelectItem value="3">Wednesday</SelectItem>
                    <SelectItem value="4">Thursday</SelectItem>
                    <SelectItem value="5">Friday</SelectItem>
                    <SelectItem value="6">Saturday</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="department_id">Department</Label>
                <Select
                  value={departmentId || "__none__"}
                  onValueChange={(v) => {
                    setDepartmentId(v === "__none__" ? "" : v);
                    setTeamId("");
                  }}
                >
                  <SelectTrigger id="department_id">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="team_id">Team</Label>
                <Select
                  value={teamId || "__none__"}
                  onValueChange={(v) => setTeamId(v === "__none__" ? "" : v)}
                  disabled={!departmentId}
                >
                  <SelectTrigger id="team_id">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {teamsInDepartment.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
              {isAdmin && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="role">Role</Label>
                  <Select value={role} onValueChange={setRole} disabled={isSelf}>
                    <SelectTrigger id="role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {humanizeRole(r)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {isSelf
                      ? "You cannot change your own role."
                      : "Changing the role revokes the employee's sessions; they must sign in again."}
                  </p>
                </div>
              )}
              {notice && <p className="text-sm text-green-600 sm:col-span-2">{notice}</p>}
              {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
              <Button type="submit" disabled={saving} className="sm:col-span-2">
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {canManage && <EmployeeEventsPanel employeeId={employeeId} />}

      {canViewAttendance && <EmployeeAttendancePanel employeeId={employeeId} />}

      {canViewAttendance && <EmployeeWorkPanel employeeId={employeeId} />}

      {canViewAttendance && <EmployeeTaskActivityPanel employeeId={employeeId} />}

      {/* Leave balance: Admin/HR viewing anyone, or the employee viewing
          their own — same tenure-prorated numbers either way. */}
      {(canManage || isSelf) && <EmployeeLeaveBalancePanel employeeId={employeeId} />}

      {/* Requests are server-scoped (Admin/HR all, Lead own team, Employee
          self); amounts are golden-rule data so only Admin/HR/self see them. */}
      <EmployeeRequestsPanel employeeId={employeeId} showAmounts={canManage || isSelf} />

      {/* Payslips: Admin/HR any; employees see their own (finalized only,
          enforced server-side). Leads viewing teammates get no panel at all. */}
      {(canManage || isSelf) && <EmployeePayslipsPanel employeeId={employeeId} />}

      <div className="flex flex-col gap-2">
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
          {/* Permanent removal — Admin-only, only reachable once deactivated,
              and blocked server-side unless the employee has zero history
              (attendance/payslip/request/task/etc.) — real employees stay
              soft-deleted only. */}
          {isAdmin && employee.status === "inactive" && (
            <Button variant="destructive" onClick={onHardDelete} disabled={hardDeleting} className="w-fit">
              {hardDeleting ? "Deleting…" : "Delete permanently"}
            </Button>
          )}
        </div>
        {hardDeleteError && <p className="text-sm text-destructive">{hardDeleteError}</p>}
      </div>
    </div>
  );
}

/** Admin/HR: upload or replace the profile photo (POST /employees/:id/photo). */
function PhotoReplaceControl({
  employeeId,
  onUploaded,
}: {
  employeeId: string;
  onUploaded: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Non-square picks are routed through the square cropper before upload.
  const [cropSource, setCropSource] = useState<File | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("photo", file);
      const res = await fetch(`/api/v1/employees/${employeeId}/photo`, {
        method: "POST",
        body: form,
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload photo.");
    } finally {
      setBusy(false);
    }
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (await isSquare(file).catch(() => false)) {
      upload(file);
    } else {
      setCropSource(file);
    }
  }

  return (
    <div className="mt-1">
      {cropSource && (
        <ImageCropModal
          file={cropSource}
          onCancel={() => setCropSource(null)}
          onCropped={(cropped) => {
            setCropSource(null);
            upload(cropped);
          }}
        />
      )}
      <label className="cursor-pointer text-xs text-primary underline-offset-2 hover:underline">
        {busy ? "Uploading…" : "Change photo"}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          disabled={busy}
          onChange={onFileChange}
          aria-label="Upload a new profile photo"
        />
      </label>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
