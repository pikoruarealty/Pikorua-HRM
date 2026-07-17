"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/components/_lib/api";

type Notification = {
  id: string;
  type: string;
  title: string | null;
  message: string;
  readAt: string | null;
  createdAt: string;
};

/** "leave_approved" -> "Leave Approved" — headline fallback for the many
 *  notification types that are a single self-contained sentence. */
function humanizeType(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function NotificationsScreen() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  async function refresh() {
    const res = await apiFetch<{ notifications: Notification[] }>("/notifications");
    if (res.data) setNotifications(res.data.notifications);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function markRead(id: string) {
    setError(null);
    const res = await apiFetch(`/notifications/${id}/read`, { method: "PATCH" });
    if (res.error) setError(`${res.error.code}: ${res.error.message}`);
    refresh();
  }

  async function markAllRead() {
    const unread = notifications.filter((n) => !n.readAt);
    await Promise.all(
      unread.map((n) => apiFetch(`/notifications/${n.id}/read`, { method: "PATCH" })),
    );
    refresh();
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) =>
      prev.size === notifications.length ? new Set() : new Set(notifications.map((n) => n.id)),
    );
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} notification${selected.size === 1 ? "" : "s"}?`)) return;
    setDeleting(true);
    setError(null);
    try {
      await Promise.all(
        [...selected].map((id) => apiFetch(`/notifications/${id}`, { method: "DELETE" })),
      );
      setSelected(new Set());
      refresh();
    } finally {
      setDeleting(false);
    }
  }

  const unreadCount = notifications.filter((n) => !n.readAt).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
          <p className="text-sm text-muted-foreground">{unreadCount} unread</p>
        </div>
        <div className="flex gap-2">
          {selected.size > 0 && (
            <Button size="sm" variant="destructive" disabled={deleting} onClick={deleteSelected}>
              {deleting ? "Deleting…" : `Delete (${selected.size})`}
            </Button>
          )}
          {unreadCount > 0 && (
            <Button size="sm" variant="outline" onClick={markAllRead}>
              Mark all read
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Your notifications</CardTitle>
          {notifications.length > 0 && (
            <label className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
              <input
                type="checkbox"
                checked={selected.size === notifications.length}
                onChange={toggleSelectAll}
                className="size-3.5"
              />
              Select all
            </label>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {notifications.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
          {notifications.map((n) => (
            <div
              key={n.id}
              className="flex items-start justify-between gap-3 rounded border p-3 text-sm"
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(n.id)}
                  onChange={() => toggleSelected(n.id)}
                  className="mt-1 size-3.5 shrink-0"
                  aria-label={`Select notification: ${n.title ?? humanizeType(n.type)}`}
                />
                {/* min-w-0 lets a long body wrap instead of stretching the row. */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{n.type}</Badge>
                    {!n.readAt && <Badge>unread</Badge>}
                  </div>
                  <p className="mt-1.5 font-medium">{n.title ?? humanizeType(n.type)}</p>
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-muted-foreground">
                    {n.message}
                  </p>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {new Date(n.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
              {!n.readAt && (
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => markRead(n.id)}
                >
                  Mark read
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
