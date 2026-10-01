"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { apiFetch } from "@/components/_lib/api";
import { isAttendanceExemptRole } from "@/lib/attendance/tracking";

// "Download attendance" (2026-10-01, owner request). Admin picks a month and which
// employees (everyone by default) and gets a PDF — one page per employee — from
// GET /attendance/export. Admin-only: the screen only renders this for Admin, and the
// route enforces it again.

type EmployeeOption = {
  id: string;
  fullName: string;
  role: string;
  status: string;
  employmentType?: string;
};

const MONTH_FMT: Intl.DateTimeFormatOptions = { month: "long", year: "numeric", timeZone: "UTC" };

function currentMonth(): string {
  // IST, like every other date in the app — the browser's own zone may differ.
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 7);
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString("en-GB", MONTH_FMT);
}

export function AttendanceExportButton() {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(currentMonth);
  const [employees, setEmployees] = useState<EmployeeOption[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the list the first time the dialog opens; everyone starts selected.
  useEffect(() => {
    if (!open || employees !== null) return;
    let cancelled = false;
    apiFetch<EmployeeOption[]>("/employees").then((res) => {
      if (cancelled) return;
      if (res.error || !res.data) {
        setError(res.error?.message ?? "Couldn't load employees.");
        return;
      }
      const tracked = res.data
        .filter((e) => e.status === "active" && !isAttendanceExemptRole(e.role))
        .sort((a, b) => a.fullName.localeCompare(b.fullName));
      setEmployees(tracked);
      setSelected(new Set(tracked.map((e) => e.id)));
    });
    return () => {
      cancelled = true;
    };
  }, [open, employees]);

  const filtered = useMemo(
    () => (employees ?? []).filter((e) => e.fullName.toLowerCase().includes(query.trim().toLowerCase())),
    [employees, query],
  );
  const allSelected = employees !== null && employees.length > 0 && selected.size === employees.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function download() {
    if (!employees || selected.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const [year, mo] = month.split("-").map(Number);
      const params = new URLSearchParams({ month: String(mo), year: String(year) });
      // Everyone selected = omit the list, so the report also covers anyone
      // added between opening this dialog and pressing Download.
      if (!allSelected) params.set("employee_ids", [...selected].join(","));
      const res = await fetch(`/api/v1/attendance/export?${params.toString()}`);
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error?.message ?? `Download failed (${res.status}).`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `attendance-${month}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Download className="size-4" />
          Download attendance
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Download attendance</DialogTitle>
          <DialogDescription>
            One PDF file with a page for each selected employee: their details, the month&apos;s totals and every day.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Month</span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8"
                aria-label="Previous month"
                onClick={() => setMonth((m) => shiftMonth(m, -1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[8.5rem] text-center text-sm font-medium">{monthLabel(month)}</span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8"
                aria-label="Next month"
                disabled={month >= currentMonth()}
                onClick={() => setMonth((m) => shiftMonth(m, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">
                Employees{" "}
                <span className="font-normal text-muted-foreground">
                  ({employees ? `${selected.size} of ${employees.length}` : "…"})
                </span>
              </span>
              <span className="flex gap-3 text-xs text-muted-foreground">
                <button
                  type="button"
                  className="underline"
                  onClick={() => setSelected(new Set((employees ?? []).map((e) => e.id)))}
                >
                  Select all
                </button>
                <button type="button" className="underline" onClick={() => setSelected(new Set())}>
                  Clear
                </button>
              </span>
            </div>

            <div className="flex items-center gap-2 rounded-md border px-2.5">
              <Search className="size-4 shrink-0 opacity-50" />
              <input
                placeholder="Search employees…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>

            <div className="max-h-64 overflow-y-auto rounded-md border p-1">
              {employees === null ? (
                <p className="px-2 py-3 text-center text-sm text-muted-foreground">Loading…</p>
              ) : filtered.length === 0 ? (
                <p className="px-2 py-3 text-center text-sm text-muted-foreground">No matches.</p>
              ) : (
                filtered.map((e) => (
                  <label
                    key={e.id}
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                  >
                    <input
                      type="checkbox"
                      className="size-4 shrink-0"
                      checked={selected.has(e.id)}
                      onChange={() => toggle(e.id)}
                    />
                    <span className="flex-1">{e.fullName}</span>
                    <span className="text-xs capitalize text-muted-foreground">{e.role.replace(/_/g, " ")}</span>
                  </label>
                ))
              )}
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" className="gap-2" disabled={busy || selected.size === 0} onClick={download}>
            <Download className="size-4" />
            {busy
              ? "Preparing PDF…"
              : selected.size
                ? `Download 1 PDF · ${selected.size} ${selected.size === 1 ? "page" : "pages"}`
                : "Download PDF"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
