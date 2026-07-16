"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/components/_lib/api";
import { PasswordField } from "@/components/settings/password-field";

// Shown full-screen (in place of the app shell) whenever the signed-in user
// still carries `mustChangePassword`. Every dashboard route renders through the
// layout that mounts this, so the user cannot reach the rest of the app until
// they replace their onboarding temp password. On success the change-password
// API clears the flag and re-issues the session cookie, so a refresh drops the
// gate and reveals the app.
export function FirstLoginGate({ email }: { email: string }) {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError("New password and confirmation do not match.");
      return;
    }
    setBusy(true);
    const res = await apiFetch("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ current_password: current, new_password: next }),
    });
    setBusy(false);
    if (res.error) {
      setError(res.error.message);
      return;
    }
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Set your password</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            Welcome{email ? `, ${email}` : ""}. You&apos;re signed in with the temporary password
            you were given at onboarding. Choose a new password to continue.
          </p>
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <PasswordField
              id="current"
              label="Temporary password"
              autoComplete="current-password"
              value={current}
              onChange={setCurrent}
            />
            <PasswordField
              id="next"
              label="New password"
              autoComplete="new-password"
              value={next}
              onChange={setNext}
              hint="At least 10 characters, with upper- and lower-case letters and a digit."
            />
            <PasswordField
              id="confirm"
              label="Confirm new password"
              autoComplete="new-password"
              value={confirm}
              onChange={setConfirm}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Set password & continue"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
