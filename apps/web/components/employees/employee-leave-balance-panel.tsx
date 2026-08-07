"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/components/_lib/api";
import { formatDate } from "@/lib/format-date";

// Per-employee paid-leave balance (2026-08-08, owner request) — Admin/HR
// viewing any employee's profile, or the employee viewing their own, see the
// same tenure-aware balance: the configured allowance prorated by months of
// service this year (a joiner mid-year hasn't accrued a full year's leave),
// plus compensation days credited back. Backed by the same
// GET /leave-config/balance the employee's own "My leave balance" card on
// /requests uses (lib/leave/balance.ts) — this panel just targets a specific
// employeeId instead of defaulting to the caller's own.

type LeaveBalance = {
  employeeId: string;
  fullName: string;
  dateOfJoining: string;
  periodMonth: number;
  periodYear: number;
  month: { allowance: number; used: number; compensated: number; remaining: number };
  year: { allowance: number; used: number; compensated: number; remaining: number };
};

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="rounded border p-2 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${highlight ? "text-primary" : ""}`}>{value}</p>
    </div>
  );
}

export function EmployeeLeaveBalancePanel({ employeeId }: { employeeId: string }) {
  const [balance, setBalance] = useState<LeaveBalance | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch<LeaveBalance>(`/leave-config/balance?employee_id=${employeeId}`).then((res) => {
      if (res.data) setBalance(res.data);
      setLoading(false);
    });
  }, [employeeId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Paid leave balance</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !balance || (balance.month.allowance === 0 && balance.year.allowance === 0) ? (
          <p className="text-sm text-muted-foreground">
            No paid-leave allowance available — either not configured yet, or this employee joined after the
            current period.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Month — used" value={balance.month.used} />
              <Stat label="Month — remaining" value={balance.month.remaining} highlight />
              <Stat label="Year — used" value={balance.year.used} />
              <Stat label="Year — remaining" value={balance.year.remaining} highlight />
            </div>
            <p className="text-xs text-muted-foreground">
              Yearly allowance prorated to {balance.year.allowance} day{balance.year.allowance === 1 ? "" : "s"} based
              on tenure (joined {formatDate(balance.dateOfJoining)}).
              {(balance.month.compensated > 0 || balance.year.compensated > 0) && (
                <>
                  {" "}
                  Includes {balance.year.compensated} compensation day{balance.year.compensated === 1 ? "" : "s"}{" "}
                  credited back this year.
                </>
              )}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
