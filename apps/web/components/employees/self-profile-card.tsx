"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/components/_lib/api";

// Self-service edit of the basics an employee owns: name, phone, date of birth
// (PATCH /me/profile). The photo is changed from the avatar at the top of the
// profile. Email, role, salary, department etc. are Admin/HR only, so they are
// deliberately not here.

export function SelfProfileCard({
  fullName: initialName,
  phone: initialPhone,
  dateOfBirth: initialDob,
  onSaved,
}: {
  fullName: string;
  phone: string | null;
  /** ISO date or datetime string from the API; only the YYYY-MM-DD part is used. */
  dateOfBirth: string | null;
  onSaved: () => void;
}) {
  const origDob = initialDob ? initialDob.slice(0, 10) : "";
  const [fullName, setFullName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [dob, setDob] = useState(origDob);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    // Send only what changed, so one stale field can't block saving another.
    const changes: Record<string, unknown> = {};
    if (fullName.trim() !== initialName) changes.full_name = fullName.trim();
    const newPhone = phone.trim() || null;
    if (newPhone !== (initialPhone ?? null)) changes.phone = newPhone;
    const newDob = dob || null;
    if (newDob !== (origDob || null)) changes.date_of_birth = newDob;
    if (Object.keys(changes).length === 0) {
      setMessage({ kind: "ok", text: "No changes to save." });
      return;
    }

    setSaving(true);
    const res = await apiFetch("/me/profile", { method: "PATCH", body: JSON.stringify(changes) });
    setSaving(false);
    if (res.error) {
      setMessage({ kind: "error", text: res.error.message });
      return;
    }
    setMessage({ kind: "ok", text: "Profile updated." });
    onSaved();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit my details</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="self_full_name">Full name</Label>
            <Input
              id="self_full_name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              maxLength={100}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="self_phone">Phone</Label>
            <Input
              id="self_phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98765 43210"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="self_dob">Date of birth</Label>
            <DatePicker id="self_dob" value={dob} onChange={setDob} />
          </div>
          <div className="flex flex-col justify-end gap-2 sm:col-span-2">
            <p className="text-xs text-muted-foreground">
              To change your photo, use &ldquo;Change photo&rdquo; under your name above. Email, role
              and pay details can only be changed by Admin or HR.
            </p>
            {message && (
              <p className={message.kind === "ok" ? "text-sm text-green-600" : "text-sm text-destructive"}>
                {message.text}
              </p>
            )}
            <div>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
