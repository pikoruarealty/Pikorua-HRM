"use client";

import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pushSupportStatus, currentStoredToken, enablePush } from "@/lib/firebase/messaging-client";

// Periodic nudge to turn push notifications on (2026-09-24, owner request:
// "prompt the employees to turn on notifications those who haven't done it
// every few time"). Deliberately a dismissible banner, not an auto-prompted
// browser permission dialog — clicking "Enable" here is the same conscious
// click PushNotificationsToggle already requires, just surfaced somewhere the
// user doesn't have to go looking for it.
//
// The "doesn't become a headache" half of that request is the snooze/backoff
// below: a dismissal hides it for 3 days, and after 5 dismissals it stops
// asking entirely until the user re-enables it themselves from Settings (at
// which point there's nothing left to nudge about anyway).

const STORAGE_KEY = "pikorua_push_banner_state";
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
const MAX_SNOOZES = 5;

type BannerState = { dismissedForever: boolean; snoozeUntil: number; snoozeCount: number };

function readState(): BannerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { dismissedForever: false, snoozeUntil: 0, snoozeCount: 0 };
    return { dismissedForever: false, snoozeUntil: 0, snoozeCount: 0, ...JSON.parse(raw) };
  } catch {
    return { dismissedForever: false, snoozeUntil: 0, snoozeCount: 0 };
  }
}

function writeState(state: BannerState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private browsing / blocked storage — the banner just reappears next
    // load, which is a minor annoyance, not a broken feature.
  }
}

export function EnablePushBanner() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const support = pushSupportStatus();
    if (support !== "ready") return; // unsupported browser or unconfigured deployment — nothing to nudge toward
    if (currentStoredToken()) return; // already enabled on this device

    const state = readState();
    if (state.dismissedForever) return;
    if (state.snoozeUntil && Date.now() < state.snoozeUntil) return;
    setVisible(true);
  }, []);

  function dismiss(forever: boolean) {
    const state = readState();
    const snoozeCount = state.snoozeCount + 1;
    writeState(
      forever || snoozeCount >= MAX_SNOOZES
        ? { dismissedForever: true, snoozeUntil: 0, snoozeCount }
        : { dismissedForever: false, snoozeUntil: Date.now() + SNOOZE_MS, snoozeCount },
    );
    setVisible(false);
  }

  async function onEnable() {
    setBusy(true);
    setError(null);
    try {
      await enablePush();
      setVisible(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to enable push notifications.");
    } finally {
      setBusy(false);
    }
  }

  if (!visible) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
      <Bell className="size-4 shrink-0 text-muted-foreground" />
      <p className="flex-1 text-muted-foreground">
        Turn on browser notifications so you don&apos;t miss task and request updates.
        {error && <span className="ml-1 text-destructive">{error}</span>}
      </p>
      <Button size="sm" onClick={onEnable} disabled={busy}>
        {busy ? "Enabling…" : "Enable"}
      </Button>
      <Button size="sm" variant="outline" onClick={() => dismiss(false)} disabled={busy}>
        Not now
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-7"
        onClick={() => dismiss(true)}
        disabled={busy}
        aria-label="Don't ask again"
        title="Don't ask again"
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
