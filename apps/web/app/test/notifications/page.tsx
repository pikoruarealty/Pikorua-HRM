"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "../_lib/api";

type Notification = { id: string; type: string; message: string; readAt: string | null; createdAt: string };

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Your notifications (GET /notifications, PATCH /notifications/:id/read)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {notifications.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
          {notifications.map((n) => (
            <div key={n.id} className="flex items-center justify-between rounded border p-3 text-sm">
              <div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{n.type}</Badge>
                  {!n.readAt && <Badge>unread</Badge>}
                </div>
                <p className="mt-1">{n.message}</p>
                <p className="text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleString()}</p>
              </div>
              {!n.readAt && (
                <Button size="sm" variant="outline" onClick={() => markRead(n.id)}>Mark read</Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
