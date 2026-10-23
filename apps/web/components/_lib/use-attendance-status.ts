"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/components/_lib/api";

export type AttendanceSession = {
  id: string;
  clockIn: string;
  clockOut: string | null;
  workLocation: "office" | "wfh";
  /** Closed by the system at the WFH session limit, not by the employee. */
  autoClosed?: boolean;
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
  // null until known; only an explicit false (Admin switched WFH off) hides the
  // WFH clock-in buttons. The server enforces it either way (POST /attendance/clock-in).
  const [wfhAllowed, setWfhAllowed] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    const res = await apiFetch<AttendanceRecord[]>("/attendance");
    if (res.data) {
      const t = todayLocal();
      // An open session wins over "today's" record: someone working from home
      // past midnight is still clocked in on the record they started, and with
      // only the date match the clock-out button vanished (and Clock In came
      // back) the moment the date turned over (2026-10-24). The list is newest
      // day first, so the first open one is the most recent.
      const open = res.data.find((r) => r.sessions?.some((s) => s.clockOut === null));
      setAttendance(open ?? res.data.find((r) => r.date.slice(0, 10) === t) ?? null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    apiFetch<{ employee: { wfhAllowed?: boolean } | null }>("/auth/me").then((res) => {
      if (res.data?.employee) setWfhAllowed(res.data.employee.wfhAllowed ?? true);
    });
  }, [refresh]);

  const sessions = attendance?.sessions ?? [];
  const openSession = sessions.find((s) => s.clockOut === null) ?? null;
  const clockedIn = openSession !== null;
  // Been in today, but currently out.
  const clockedOut = !clockedIn && !!attendance?.clockInRaw;

  return { attendance, sessions, openSession, clockedIn, clockedOut, loading, refresh, wfhAllowed };
}

/** Worked milliseconds so far: closed sessions summed, plus the open one
 *  running up to `now`. Breaks between sessions are never counted. */
export function workedMs(sessions: AttendanceSession[], now: number): number {
  return sessions.reduce((acc, s) => {
    const end = s.clockOut ? new Date(s.clockOut).getTime() : now;
    return acc + Math.max(0, end - new Date(s.clockIn).getTime());
  }, 0);
}
