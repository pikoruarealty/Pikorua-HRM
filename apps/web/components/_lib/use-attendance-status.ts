"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/components/_lib/api";

export type AttendanceSession = {
  id: string;
  clockIn: string;
  clockOut: string | null;
  workLocation: "office" | "wfh";
};

type AttendanceRecord = {
  id: string;
  date: string;
  clockInRaw: string | null;
  clockOutRaw: string | null;
  workLocation: "office" | "wfh";
  sessions?: AttendanceSession[];
};

function todayLocal(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Today's attendance record for the current employee + derived clocked-in
 *  state, shared by any screen that needs to gate on clock-in status.
 *
 *  Since 2026-08-11 a day is a list of sessions: `clockedIn` means an OPEN
 *  session right now (which is what the server gates progress logging on),
 *  while `clockedOut` means they've been in today but are currently out — a
 *  break or the end of the day, and either way they can clock back in. */
export function useAttendanceStatus() {
  const [attendance, setAttendance] = useState<AttendanceRecord | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const res = await apiFetch<AttendanceRecord[]>("/attendance");
    if (res.data) {
      const t = todayLocal();
      setAttendance(res.data.find((r) => r.date.slice(0, 10) === t) ?? null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const sessions = attendance?.sessions ?? [];
  const openSession = sessions.find((s) => s.clockOut === null) ?? null;
  const clockedIn = openSession !== null;
  // Been in today, but currently out.
  const clockedOut = !clockedIn && !!attendance?.clockInRaw;

  return { attendance, sessions, openSession, clockedIn, clockedOut, loading, refresh };
}

/** Worked milliseconds so far: closed sessions summed, plus the open one
 *  running up to `now`. Breaks between sessions are never counted. */
export function workedMs(sessions: AttendanceSession[], now: number): number {
  return sessions.reduce((acc, s) => {
    const end = s.clockOut ? new Date(s.clockOut).getTime() : now;
    return acc + Math.max(0, end - new Date(s.clockIn).getTime());
  }, 0);
}
