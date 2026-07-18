"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/components/_lib/api";

type AttendanceRecord = {
  id: string;
  date: string;
  clockInRaw: string | null;
  clockOutRaw: string | null;
};

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Today's attendance record for the current employee + derived clocked-in
 *  state, shared by any screen that needs to gate on clock-in status. */
export function useAttendanceStatus() {
  const [attendance, setAttendance] = useState<AttendanceRecord | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const res = await apiFetch<AttendanceRecord[]>("/attendance");
    if (res.data) {
      const t = todayUtc();
      setAttendance(res.data.find((r) => r.date.slice(0, 10) === t) ?? null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const clockedIn = !!attendance?.clockInRaw;
  const clockedOut = !!attendance?.clockOutRaw;

  return { attendance, clockedIn, clockedOut, loading, refresh };
}
