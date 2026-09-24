"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, Check, TriangleAlert } from "lucide-react";
import { IconActionButton } from "@/components/ui/icon-action-button";
import { apiFetch } from "@/components/_lib/api";

// Admin/HR on-demand "nudge" (2026-09-24). One component for both the per-task
// button (work unit page) and the per-employee button (team task progress) —
// they differ only in endpoint + label. Feedback is the button itself: icon and
// tooltip swap to "sent" / the error for a few seconds, since the app has no
// toast layer and a modal for a one-line acknowledgement would be heavier than
// the action deserves.
type Result = { sent: number; openTasks?: number };

export function RemindButton({ endpoint, label }: { endpoint: string; label: string }) {
  const [state, setState] = useState<{ kind: "idle" | "sent" | "error"; text: string }>({
    kind: "idle",
    text: label,
  });
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function flash(kind: "sent" | "error", text: string) {
    setState({ kind, text });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState({ kind: "idle", text: label }), 3500);
  }

  async function onClick() {
    setBusy(true);
    const res = await apiFetch<Result>(endpoint, { method: "POST" });
    setBusy(false);
    if (res.error) return flash("error", res.error.message);
    const r = res.data;
    if (r && r.sent === 0) return flash("error", "No open tasks to remind about.");
    flash("sent", "Reminder sent");
  }

  return (
    <IconActionButton
      icon={state.kind === "sent" ? Check : state.kind === "error" ? TriangleAlert : Bell}
      variant="ghost"
      label={state.text}
      disabled={busy}
      onClick={onClick}
    />
  );
}
