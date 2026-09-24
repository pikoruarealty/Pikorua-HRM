"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  pushSupportStatus,
  currentStoredToken,
  enablePush,
  disablePush,
  isBraveBrowser,
  type PushSupport,
} from "@/lib/firebase/messaging-client";

// Opt-in push notification toggle (added 2026-07-15). Every existing
// notification type (leave decisions, admin overrides, meeting reminders,
// birthdays, EOD summaries, recognition) already flows through
// `pushNotification()` server-side — this toggle just registers/unregisters
// the current browser as a delivery target for that same stream via FCM.
// Deliberately manual (a click), never auto-prompted, since browser
// notification permission is something the user should consciously grant.
export function PushNotificationsToggle() {
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isBrave, setIsBrave] = useState(false);
  const [testing, setTesting] = useState(false);
  const [diag, setDiag] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setSupport(pushSupportStatus());
    setEnabled(!!currentStoredToken());
    isBraveBrowser().then(setIsBrave);
  }, []);

  async function onEnable() {
    setBusy(true);
    setError(null);
    try {
      await enablePush();
      setEnabled(true);
      setSupport(pushSupportStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to enable push notifications.");
    } finally {
      setBusy(false);
    }
  }

  async function onDisable() {
    setBusy(true);
    setError(null);
    try {
      await disablePush();
      setEnabled(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to disable push notifications.");
    } finally {
      setBusy(false);
    }
  }

  // "Why don't I see popups?" — asks the server what it can actually do, then
  // sends a real push and reports FCM's answer, so the failure is named
  // (server key missing / device not registered / FCM rejected / OS-level block)
  // instead of guessed at.
  async function onTest() {
    setTesting(true);
    setDiag(null);
    try {
      const token = currentStoredToken();
      const statusRes = await fetch(
        `/api/v1/notifications/push-status${token ? `?token=${encodeURIComponent(token)}` : ""}`,
      );
      const status = (await statusRes.json()).data as
        | { serverConfigured: boolean; thisDeviceRegistered: boolean | null }
        | null;
      if (!status) throw new Error("Could not check push status.");
      if (!status.serverConfigured) {
        return setDiag({
          ok: false,
          text:
            "The server can't send push notifications: its Firebase admin key isn't configured " +
            "(FIREBASE_ADMIN_PROJECT_ID / FIREBASE_ADMIN_CLIENT_EMAIL / FIREBASE_ADMIN_PRIVATE_KEY in the server's .env). " +
            "In-app notifications still work. This needs to be fixed on the server, not in your browser.",
        });
      }
      if (status.thisDeviceRegistered === false) {
        await enablePush(); // permission is already granted — re-registers without a prompt
        setEnabled(true);
      }
      const result = (await (await fetch("/api/v1/notifications/push-test", { method: "POST" })).json()).data as
        | { attempts: { ok: boolean; code?: string }[]; registeredTokens: number }
        | null;
      if (!result || result.registeredTokens === 0) {
        return setDiag({ ok: false, text: "No device is registered for your account. Turn notifications off and on again." });
      }
      const failed = result.attempts.filter((a) => !a.ok);
      if (failed.length === result.attempts.length) {
        return setDiag({
          ok: false,
          text: `Google's push service rejected the send (${failed.map((f) => f.code).join(", ")}). Turn notifications off and on again on this device.`,
        });
      }
      setDiag({
        ok: true,
        text:
          `Sent to ${result.attempts.length - failed.length} of ${result.attempts.length} device(s). ` +
          "If no popup appears, the block is on this computer: in Windows check Settings → System → Notifications " +
          "(Chrome must be on; turn off Do not disturb / Focus assist), and in Chrome check chrome://settings/content/notifications.",
      });
    } catch (e) {
      setDiag({ ok: false, text: e instanceof Error ? e.message : "Test failed." });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card className="max-w-md">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Push notifications</CardTitle>
        {support === "ready" && (
          <Badge variant={enabled ? "default" : "outline"}>{enabled ? "On" : "Off"}</Badge>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Get a browser notification the moment something happens — leave decisions, meeting
          reminders, and everything else you already see under Notifications.
        </p>

        {support === "unsupported" && (
          <p className="text-sm text-muted-foreground">
            Your browser does not support push notifications.
          </p>
        )}
        {support === "unconfigured" && (
          <p className="text-sm text-muted-foreground">
            Push notifications are not configured for this deployment yet.
          </p>
        )}
        {support === "denied" && (
          <p className="text-sm text-destructive">
            Notifications are blocked for this site in your browser settings. Allow them there,
            then reload this page.
          </p>
        )}
        {support === "ready" && isBrave && !enabled && (
          <p className="text-xs text-muted-foreground">
            Using Brave? It blocks push by default. If enabling fails, turn on
            Settings → Privacy and security → &quot;Use Google services for push
            messaging&quot;, then reload this page.
          </p>
        )}
        {support === "ready" && (
          <Button onClick={enabled ? onDisable : onEnable} disabled={busy} className="w-fit">
            {busy ? "Working…" : enabled ? "Disable on this device" : "Enable on this device"}
          </Button>
        )}
        {support === "ready" && enabled && (
          <Button variant="outline" onClick={onTest} disabled={testing || busy} className="w-fit">
            {testing ? "Testing…" : "Send test notification"}
          </Button>
        )}
        {diag && (
          <p className={diag.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>{diag.text}</p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
