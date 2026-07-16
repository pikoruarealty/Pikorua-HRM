"use client";

import { useState } from "react";
import Link from "next/link";
import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTheme } from "@/lib/hooks/use-theme";

const GENERIC_MESSAGE =
  "If an account exists for that email, we've sent a password reset link.";

export default function ForgotPasswordPage() {
  const [dark, toggleTheme] = useTheme();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    // Always show the same outcome regardless of the API response, so the
    // no-enumeration guarantee holds end-to-end, not just server-side.
    await fetch("/api/v1/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => null);
    setSubmitting(false);
    setSent(true);
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center p-6">
      <button
        type="button"
        onClick={toggleTheme}
        className="absolute right-4 top-4 flex items-center gap-2 rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      >
        {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
      </button>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Reset your password</CardTitle>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">{GENERIC_MESSAGE}</p>
              <Link
                href="/login"
                className="text-sm font-medium text-primary hover:underline"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                Enter the email associated with your account and we&apos;ll send you a
                link to reset your password.
              </p>
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Sending…" : "Send reset link"}
              </Button>
              <Link
                href="/login"
                className="text-center text-sm text-muted-foreground hover:text-foreground hover:underline"
              >
                Back to sign in
              </Link>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
