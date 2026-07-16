"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ImageCropModal, isSquare } from "@/components/employees/image-cropper";

/** yyyy-mm-dd (ISO date) shown to the user as dd/mm/yyyy. */
function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** dd/mm/yyyy -> yyyy-mm-dd, or "" if not a valid calendar date. */
function displayToIso(display: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(display.trim());
  if (!m) return "";
  const [, dd, mm, yyyy] = m;
  const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(dd) || d.getUTCMonth() + 1 !== Number(mm)) {
    return "";
  }
  return `${yyyy}-${mm}-${dd}`;
}

function todayIso(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Date field displayed as dd/mm/yyyy with a native date picker for convenience.
 *  `value`/`onChange` speak ISO (yyyy-mm-dd) so the API contract is unchanged. */
function DateField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (iso: string) => void;
}) {
  const [text, setText] = useState(isoToDisplay(value));

  // Keep the text mirror in sync when the ISO value changes from outside
  // (e.g. the native picker) and the field isn't mid-edit.
  useEffect(() => {
    setText(isoToDisplay(value));
  }, [value]);

  return (
    <div className="relative">
      <Input
        id={id}
        inputMode="numeric"
        placeholder="DD/MM/YYYY"
        value={text}
        className="pr-10"
        onChange={(e) => {
          setText(e.target.value);
          const iso = displayToIso(e.target.value);
          if (iso) onChange(iso);
        }}
        onBlur={() => setText(isoToDisplay(value))}
        required
      />
      <label
        className="absolute inset-y-0 right-0 flex cursor-pointer items-center px-3 text-muted-foreground hover:text-foreground"
        aria-label="Open date picker"
      >
        <Calendar className="size-4" />
        <input
          type="date"
          className="sr-only"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    </div>
  );
}

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
  const [dateOfJoining, setDateOfJoining] = useState(todayIso());
  const [baseSalary, setBaseSalary] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  // Image awaiting a square crop (opened automatically for non-square uploads).
  const [cropSource, setCropSource] = useState<File | null>(null);

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

  /** Set the active photo + its preview, revoking any previous object URL. */
  function applyPhoto(file: File) {
    setPhoto(file);
    setPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  }

  /** On pick: use square images as-is, otherwise open the square cropper. */
  async function onPickPhoto(file: File | null) {
    if (!file) {
      setPhoto(null);
      setPhotoPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }
    if (await isSquare(file).catch(() => false)) {
      applyPhoto(file);
    } else {
      setCropSource(file);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (!photo) {
        throw new Error("A profile photo is required.");
      }
      // Multipart since 2026-07-15: the profile photo is required at creation.
      const form = new FormData();
      form.set("full_name", fullName);
      form.set("email", email);
      if (phone) form.set("phone", phone);
      form.set("role", role);
      if (departmentId) form.set("department_id", departmentId);
      if (teamId) form.set("team_id", teamId);
      form.set("date_of_joining", dateOfJoining);
      form.set("base_salary", baseSalary);
      form.set("photo", photo);
      const data = await getJson(
        await fetch("/api/v1/employees", { method: "POST", body: form }),
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
    <>
    {cropSource && (
      <ImageCropModal
        file={cropSource}
        onCancel={() => setCropSource(null)}
        onCropped={(cropped) => {
          applyPhoto(cropped);
          setCropSource(null);
        }}
      />
    )}
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
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger id="role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                  </SelectItem>
                ))}
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
            <Label htmlFor="date_of_joining">Date of joining</Label>
            <DateField id="date_of_joining" value={dateOfJoining} onChange={setDateOfJoining} />
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
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="photo">Profile photo (required)</Label>
            <div className="flex items-center gap-4">
              {photoPreview && (
                <div className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                  <img
                    src={photoPreview}
                    alt="Selected profile photo preview"
                    className="h-16 w-16 rounded-full object-cover border"
                  />
                  {photo && (
                    <button
                      type="button"
                      className="text-xs text-primary underline-offset-2 hover:underline"
                      onClick={() => setCropSource(photo)}
                    >
                      Crop
                    </button>
                  )}
                </div>
              )}
              <Input
                id="photo"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                required={!photo}
                onChange={(e) => onPickPhoto(e.target.files?.[0] ?? null)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              JPEG, PNG, or WebP, up to 5MB. Non-square images open a cropper.
            </p>
          </div>
          {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
          <Button type="submit" disabled={submitting} className="sm:col-span-2">
            {submitting ? "Creating…" : "Create employee"}
          </Button>
        </form>
      </CardContent>
    </Card>
    </>
  );
}
