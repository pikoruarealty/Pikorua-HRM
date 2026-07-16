"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/components/_lib/api";
import { PushNotificationsToggle } from "@/components/settings/push-notifications-toggle";

export function SecurityScreen() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (next !== confirm) {
      setMessage({ kind: "error", text: "New password and confirmation do not match." });
      return;
    }
    setBusy(true);
    const res = await apiFetch("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ current_password: current, new_password: next }),
    });
    setBusy(false);
    if (res.error) {
      setMessage({ kind: "error", text: res.error.message });
      return;
    }
    setCurrent("");
    setNext("");
    setConfirm("");
    setMessage({ kind: "ok", text: "Password changed." });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Account Security</h1>
        <p className="text-sm text-muted-foreground">
          Change the password you sign in with. If you are still using the temporary password you
          were given at onboarding, change it now.
        </p>
      </div>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Change password</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="current">Current password</Label>
              <Input
                id="current"
                type="password"
                autoComplete="current-password"
                required
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="next">New password</Label>
              <Input
                id="next"
                type="password"
                autoComplete="new-password"
                required
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                At least 10 characters, with upper- and lower-case letters and a digit.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirm">Confirm new password</Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            {message && (
              <p
                className={
                  message.kind === "ok" ? "text-sm text-green-600" : "text-sm text-destructive"
                }
              >
                {message.text}
              </p>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? "Changing…" : "Change password"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <PushNotificationsToggle />
    </div>
  );
}
