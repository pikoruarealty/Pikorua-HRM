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
import { EmployeePerformanceReviewPanel } from "@/components/employees/employee-performance-review-panel";
import { EmployeeAvatar } from "@/components/employees/employee-avatar";
import { EmployeeEventsPanel } from "@/components/employees/employee-events-panel";
import { EmployeeLeaveBalancePanel } from "@/components/employees/employee-leave-balance-panel";
import { formatDate } from "@/lib/format-date";
import { isMetricDepartment } from "@/lib/departments/type";
import { ImageCropModal, isSquare } from "@/components/employees/image-cropper";
import {
  EmployeeRequestsPanel,
  EmployeePayslipsPanel,
} from "@/components/employees/employee-profile-panels";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

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
  deviceUid: string | null;
  photoUrl: string | null;
  createdAt: string;
  baseSalary?: string;
  dailyCallTarget?: number | null;
  monthlySiteVisitTarget?: number | null;
  monthlyBookingTarget?: number | null;
};

type Department = { id: string; name: string; typeKey?: string };
type Team = { id: string; name: string; departmentId: string; defaultWeeklyOffDay?: number };
type UnmatchedDevice = {
  deviceUid: string;
  name: string | null;
  punchCount: number;
  suggestions: { employeeId: string; fullName: string; similarity: number }[];
};

type RoleOption = { key: string; label: string };

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
  if (json.error) {
    const err = new ApiError(json.error.code, json.error.message);
    // Attach meta from enriched error responses (e.g. requiresReassignment)
    (err as ApiError & { meta?: Record<string, unknown> }).meta = json.meta;
    throw err;
  }
  return json.data;
}

export function EmployeeDetail({
  employeeId,
  canManage,
  isAdmin,
  canViewAttendance,
  canManageSalesTargets,
  isSelf,
}: {
  employeeId: string;
  canManage: boolean;
  isAdmin: boolean;
  canViewAttendance: boolean;
  canManageSalesTargets: boolean;
  isSelf: boolean;
}) {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
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

  const [dailyCallTarget, setDailyCallTarget] = useState("");
  const [monthlySiteVisitTarget, setMonthlySiteVisitTarget] = useState("");
  const [monthlyBookingTarget, setMonthlyBookingTarget] = useState("");
  const [savingTargets, setSavingTargets] = useState(false);
  const [targetsError, setTargetsError] = useState<string | null>(null);
  const [hardDeleteError, setHardDeleteError] = useState<string | null>(null);
  const [hardDeleting, setHardDeleting] = useState(false);

  // Reassignment dialog state
  type ActiveEmployee = { id: string; fullName: string; role: string };
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteDialogLoading, setDeleteDialogLoading] = useState(false);
  const [pendingWorkCounts, setPendingWorkCounts] = useState<{ assignedWorkItems: number; ledWorkUnits: number; finalizedPayslips: number } | null>(null);
  const [activeEmployees, setActiveEmployees] = useState<ActiveEmployee[]>([]);
  const [reassignToId, setReassignToId] = useState("");
  const [unmatchedDevices, setUnmatchedDevices] = useState<UnmatchedDevice[]>([]);

  const router = useRouter();

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      // Departments/teams are fetched for every viewer so the profile can
      // show names instead of ids (both endpoints are role-safe: departments
      // is Any, teams is server-scoped).
      const [emp, deptData, teamData, unmatched, roleData] = await Promise.all([
        getJson(await fetch(`/api/v1/employees/${employeeId}`)),
        getJson(await fetch("/api/v1/departments")).catch(() => []),
        getJson(await fetch("/api/v1/teams")).catch(() => []),
        // Admin-only endpoint — a non-Admin viewer falls back to the plain
        // text input, so a fetch failure there is expected, not an error.
        isAdmin
          ? getJson(await fetch("/api/v1/device-mapping/unmatched")).then((d) => d.unmatched as UnmatchedDevice[]).catch(() => [])
          : Promise.resolve([]),
        // Roles are DB-backed (2026-08-13) — only Admin sees/uses the role
        // Select, but any authenticated role can list them.
        isAdmin ? getJson(await fetch("/api/v1/roles")).catch(() => []) : Promise.resolve([]),
      ]);
      setEmployee(emp);
      setDepartments(deptData);
      setTeams(teamData);
      setUnmatchedDevices(unmatched);
      setRoles(roleData);
      setDepartmentId(emp.departmentId ?? "");
      setTeamId(emp.teamId ?? "");
      setBaseSalary(emp.baseSalary ?? "");
      // Default-select the name-matched suggestion when this employee has no
      // deviceUid yet — otherwise keep whatever is already assigned.
      if (!emp.deviceUid) {
        const matched = unmatched.find((u: UnmatchedDevice) =>
          u.suggestions.some((s) => s.employeeId === employeeId),
        );
        setDeviceUid(matched?.deviceUid ?? "");
      } else {
        setDeviceUid(emp.deviceUid);
      }
      setRole(emp.role);
      setEmploymentType(emp.employmentType ?? "fulltime");
      setRequiredDaysPerWeek(emp.requiredDaysPerWeek?.toString() ?? "");
      setDefaultWeeklyOffDay(emp.defaultWeeklyOffDay !== null && emp.defaultWeeklyOffDay !== undefined ? String(emp.defaultWeeklyOffDay) : "__default__");
      setFullName(emp.fullName);
      setEmail(emp.email);
      setPhone(emp.phone ?? "");
      setDateOfBirth(emp.dateOfBirth ? emp.dateOfBirth.slice(0, 10) : "");
      setDateOfJoining(emp.dateOfJoining.slice(0, 10));
      setDailyCallTarget(emp.dailyCallTarget !== null && emp.dailyCallTarget !== undefined ? String(emp.dailyCallTarget) : "");
      setMonthlySiteVisitTarget(
        emp.monthlySiteVisitTarget !== null && emp.monthlySiteVisitTarget !== undefined
          ? String(emp.monthlySiteVisitTarget)
          : "",
      );
      setMonthlyBookingTarget(
        emp.monthlyBookingTarget !== null && emp.monthlyBookingTarget !== undefined
          ? String(emp.monthlyBookingTarget)
          : "",
      );
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
    setError(null);
    setNotice(null);
    if (!employee) return;

    // Only an admin may change role, and only send it when it actually changed
    // (a no-op role in the body would needlessly revoke the employee's session).
    const roleChanged = isAdmin && !isSelf && role !== employee.role;

    // Diff against the loaded record and send only what actually changed —
    // sending the whole form every time meant an edit to one field (e.g. just
    // the name) could fail PATCH's validation on some unrelated field's stale
    // or edge-case value, with no way to tell which one from the generic
    // "Invalid request body" error.
    const changes: Record<string, unknown> = {};
    if (fullName !== employee.fullName) changes.full_name = fullName;
    if (email !== employee.email) changes.email = email;
    const newPhone = phone || null;
    if (newPhone !== (employee.phone ?? null)) changes.phone = newPhone;
    const newDob = dateOfBirth || null;
    const origDob = employee.dateOfBirth ? employee.dateOfBirth.slice(0, 10) : null;
    if (newDob !== origDob) changes.date_of_birth = newDob;
    if (dateOfJoining !== employee.dateOfJoining.slice(0, 10)) changes.date_of_joining = dateOfJoining;
    if (employmentType !== (employee.employmentType ?? "fulltime")) changes.employment_type = employmentType;
    const newRequiredDays =
      employmentType !== "fulltime" && requiredDaysPerWeek ? Number(requiredDaysPerWeek) : null;
    if (newRequiredDays !== (employee.requiredDaysPerWeek ?? null)) {
      changes.required_days_per_week = newRequiredDays;
    }
    const newOffDay = defaultWeeklyOffDay !== "__default__" ? Number(defaultWeeklyOffDay) : null;
    if (newOffDay !== (employee.defaultWeeklyOffDay ?? null)) changes.default_weekly_off_day = newOffDay;
    const newDept = departmentId || null;
    if (newDept !== (employee.departmentId ?? null)) changes.department_id = newDept;
    const newTeam = teamId || null;
    if (newTeam !== (employee.teamId ?? null)) changes.team_id = newTeam;
    const newSalary = Number(baseSalary);
    if (newSalary !== Number(employee.baseSalary ?? 0)) changes.base_salary = newSalary;
    const newDevice = deviceUid.trim() ? deviceUid.trim() : null;
    if (newDevice !== (employee.deviceUid ?? null)) changes.device_uid = newDevice;
    if (roleChanged) changes.role = role;

    if (Object.keys(changes).length === 0) {
      setNotice("No changes to save.");
      return;
    }

    setSaving(true);
    try {
      await getJson(
        await fetch(`/api/v1/employees/${employeeId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(changes),
        }),
      );
      setNotice(
        roleChanged
          ? "Role updated. The employee's active sessions were revoked — they must sign in again to get the new permissions."
          : "Saved.",
      );
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function onSaveSalesTargets(e: React.FormEvent) {
    e.preventDefault();
    setSavingTargets(true);
    setTargetsError(null);
    try {
      await getJson(
        await fetch(`/api/v1/employees/${employeeId}/sales-targets`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            daily_call_target: dailyCallTarget ? Number(dailyCallTarget) : null,
            monthly_site_visit_target: monthlySiteVisitTarget ? Number(monthlySiteVisitTarget) : null,
            monthly_booking_target: monthlyBookingTarget ? Number(monthlyBookingTarget) : null,
          }),
        }),
      );
      load();
    } catch (e) {
      setTargetsError(e instanceof Error ? e.message : "Failed to save sales targets.");
    } finally {
      setSavingTargets(false);
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

  async function openDeleteDialog() {
    setDeleteDialogOpen(true);
    setDeleteDialogLoading(true);
    setHardDeleteError(null);
    setReassignToId("");
    setPendingWorkCounts(null);
    try {
      // Fetch pending work counts and full active-employees list in parallel
      const [countsRes, empRes] = await Promise.all([
        fetch(`/api/v1/employees/${employeeId}/hard-delete`),
        fetch("/api/v1/employees"),
      ]);
      const counts = await countsRes.json();
      const emps = await empRes.json();
      setPendingWorkCounts(counts.data ?? { assignedWorkItems: 0, ledWorkUnits: 0, finalizedPayslips: 0 });
      setActiveEmployees(
        (emps.data ?? []).filter(
          (e: ActiveEmployee & { status?: string }) =>
            e.id !== employeeId && e.status === "active",
        ),
      );
    } catch {
      setHardDeleteError("Failed to load deletion details. Please try again.");
      setDeleteDialogOpen(false);
    } finally {
      setDeleteDialogLoading(false);
    }
  }

  async function confirmHardDelete() {
    const needsReassign =
      pendingWorkCounts &&
      (pendingWorkCounts.assignedWorkItems > 0 || pendingWorkCounts.ledWorkUnits > 0);

    if (needsReassign && !reassignToId) {
      setHardDeleteError("Please select an employee to reassign their work to.");
      return;
    }

    setHardDeleting(true);
    setHardDeleteError(null);
    try {
      await getJson(
        await fetch(`/api/v1/employees/${employeeId}/hard-delete`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(needsReassign && reassignToId ? { reassign_to: reassignToId } : {}),
        }),
      );
      setDeleteDialogOpen(false);
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
  const isMetric = isMetricDepartment(departments.find((d) => d.id === employee.departmentId)?.typeKey);

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

      {employee && isMetric && (
          <Card>
            <CardHeader>
              <CardTitle>Sales targets (override)</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Wins over the org-wide default where set. Leave blank to fall back to the
                org-wide sales target config.
              </p>
              <dl className="grid grid-cols-3 gap-x-8 gap-y-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">Daily calls</dt>
                  <dd className="font-medium">{employee.dailyCallTarget ?? "org default"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Monthly site visits</dt>
                  <dd className="font-medium">{employee.monthlySiteVisitTarget ?? "org default"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Monthly bookings</dt>
                  <dd className="font-medium">{employee.monthlyBookingTarget ?? "org default"}</dd>
                </div>
              </dl>
              {canManageSalesTargets && (
                <form onSubmit={onSaveSalesTargets} className="flex flex-wrap items-end gap-4 border-t pt-3">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="override_calls">Daily calls</Label>
                    <Input
                      id="override_calls"
                      type="number"
                      min="1"
                      placeholder="org default"
                      value={dailyCallTarget}
                      onChange={(e) => setDailyCallTarget(e.target.value)}
                      className="w-32"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="override_visits">Monthly site visits</Label>
                    <Input
                      id="override_visits"
                      type="number"
                      min="0"
                      placeholder="org default"
                      value={monthlySiteVisitTarget}
                      onChange={(e) => setMonthlySiteVisitTarget(e.target.value)}
                      className="w-32"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="override_bookings">Monthly bookings</Label>
                    <Input
                      id="override_bookings"
                      type="number"
                      min="0"
                      placeholder="org default"
                      value={monthlyBookingTarget}
                      onChange={(e) => setMonthlyBookingTarget(e.target.value)}
                      className="w-32"
                    />
                  </div>
                  {targetsError && <p className="w-full text-sm text-destructive">{targetsError}</p>}
                  <Button type="submit" disabled={savingTargets}>
                    {savingTargets ? "Saving…" : "Save targets"}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        )}

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
                <Label htmlFor="device_uid">Device UID (Empcode)</Label>
                {isAdmin ? (
                  <>
                    <Select value={deviceUid || "__none__"} onValueChange={(v) => setDeviceUid(v === "__none__" ? "" : v)}>
                      <SelectTrigger id="device_uid">
                        <SelectValue placeholder="Not mapped" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Not mapped</SelectItem>
                        {/* The employee's current mapping may no longer appear in
                            unmatchedDevices (a reconciled Empcode drops off that
                            list), so it's always offered as an option here. */}
                        {employee?.deviceUid && !unmatchedDevices.some((u) => u.deviceUid === employee.deviceUid) && (
                          <SelectItem value={employee.deviceUid}>
                            {employee.deviceUid} (currently mapped)
                          </SelectItem>
                        )}
                        {unmatchedDevices.map((u) => (
                          <SelectItem key={u.deviceUid} value={u.deviceUid}>
                            {u.deviceUid}
                            {u.name ? ` — ${u.name}` : ""} ({u.punchCount} punch{u.punchCount === 1 ? "" : "es"})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Unmapped Empcodes seen recently on the biometric device. The name-matched
                      one is pre-selected when available.
                    </p>
                  </>
                ) : (
                  <Input id="device_uid" type="text" value={deviceUid} disabled />
                )}
              </div>
              {isAdmin && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="role">Role</Label>
                  <Select value={role} onValueChange={setRole} disabled={isSelf}>
                    <SelectTrigger id="role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((r) => (
                        <SelectItem key={r.key} value={r.key}>
                          {r.label}
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

      {canViewAttendance && <EmployeeWorkPanel employeeId={employeeId} isMetric={isMetric} />}

      {canViewAttendance && <EmployeeTaskActivityPanel employeeId={employeeId} isMetric={isMetric} />}

      {/* Monthly Lead review (Pillar 3): same audience as the API allows —
          self, the owning Lead, Admin/HR. Read-only here; reviews are written
          on /performance/review. */}
      {canViewAttendance && <EmployeePerformanceReviewPanel employeeId={employeeId} />}

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
          {/* Permanent removal — Admin-only, only reachable once deactivated.
              Shows a dialog asking the admin to pick a reassignment target
              if the employee has active work items or led projects. */}
          {isAdmin && employee.status === "inactive" && (
            <Button variant="destructive" onClick={openDeleteDialog} disabled={hardDeleting} className="w-fit">
              Delete permanently
            </Button>
          )}
        </div>
        {hardDeleteError && !deleteDialogOpen && <p className="text-sm text-destructive">{hardDeleteError}</p>}

        {/* Reassignment / confirmation dialog */}
        <Dialog open={deleteDialogOpen} onOpenChange={(open) => { if (!hardDeleting) setDeleteDialogOpen(open); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-destructive">Permanently delete employee</DialogTitle>
              <DialogDescription>
                {deleteDialogLoading
                  ? "Loading…"
                  : pendingWorkCounts && pendingWorkCounts.finalizedPayslips > 0
                  ? <>This employee has <strong>{pendingWorkCounts.finalizedPayslips} finalized payslip(s)</strong>, a permanent payroll record. They must be unfinalized first (Payslips → the payslip → Unfinalize, with a reason) before this employee can be permanently deleted.</>
                  : pendingWorkCounts && (pendingWorkCounts.assignedWorkItems > 0 || pendingWorkCounts.ledWorkUnits > 0)
                  ? <>This employee has <strong>{pendingWorkCounts.assignedWorkItems} task(s)</strong> and leads <strong>{pendingWorkCounts.ledWorkUnits} project(s)</strong>. Choose an active employee to take over their work before deleting. This action cannot be undone.</>
                  : "This will permanently remove the employee and all their records. This action cannot be undone."}
              </DialogDescription>
            </DialogHeader>

            {!deleteDialogLoading && pendingWorkCounts && pendingWorkCounts.finalizedPayslips === 0 && (pendingWorkCounts.assignedWorkItems > 0 || pendingWorkCounts.ledWorkUnits > 0) && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reassign-to">Reassign work to</Label>
                <Select value={reassignToId} onValueChange={setReassignToId}>
                  <SelectTrigger id="reassign-to">
                    <SelectValue placeholder="Select an employee…" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeEmployees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.fullName} <span className="text-muted-foreground">({humanizeRole(e.role)})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {hardDeleteError && <p className="text-sm text-destructive">{hardDeleteError}</p>}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeleteDialogOpen(false)}
                disabled={hardDeleting}
              >
                Cancel
              </Button>
              {!(pendingWorkCounts && pendingWorkCounts.finalizedPayslips > 0) && (
                <Button
                  variant="destructive"
                  onClick={confirmHardDelete}
                  disabled={hardDeleting || deleteDialogLoading}
                >
                  {hardDeleting ? "Deleting…" : "Delete permanently"}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
