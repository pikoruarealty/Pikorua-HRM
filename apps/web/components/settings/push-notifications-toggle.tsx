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

  useEffect(() => {
    setSupport(pushSupportStatus());
    setEnabled(!!currentStoredToken());
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
        {support === "ready" && (
          <Button onClick={enabled ? onDisable : onEnable} disabled={busy} className="w-fit">
            {busy ? "Working…" : enabled ? "Disable on this device" : "Enable on this device"}
          </Button>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
