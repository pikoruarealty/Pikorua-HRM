import fs from "fs";
import path from "path";
import { Fragment } from "react";
import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { COMPANY_INFO } from "@/lib/payroll/company-info";
import type { AttendanceReportEmployee, ReportDay, ReportTone } from "@/lib/attendance/report";
import { groupMadeUp, madeUpSentence, type MadeUpGroup } from "@/lib/attendance/extra-days";

// Attendance report PDF (2026-10-01, owner request): one A4 page per employee —
// their details, the month's totals and every day of the month — laid out like the
// app's own attendance screen (same colours for office / WFH / half-day /
// compensation / absent / leave) so it reads as the same thing printed. Rendered
// server-side by GET /attendance/export via @react-pdf/renderer, like the payslip.
//
// The page is sized to hold a 31-day month on ONE page: rows are fixed-height and
// nothing in the body wraps.
//
// 2026-11-01: a summary page comes first (landscape) — every selected employee's
// month on one table with the dashboard's metrics and totals, plus everything worth
// a look before paying (cross-month make-ups, balance days used, long days, pending
// days). Each employee page now shows days worked in advance (banked, not paid),
// compensation days (which missed day each made up) and balance days, with their
// dates — see lib/attendance/extra-days.ts for the rule. Built-in Helvetica has no ₹ glyph (see payslip-pdf.tsx)
// — this report has no money on it — but it does have ½, · and —.

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export type AttendanceReportInput = {
  month: number;
  year: number;
  generatedAt: string;
  generatedBy: string | null;
  employees: AttendanceReportEmployee[];
};

// Same read-the-bytes-ourselves approach as the payslip (react-pdf's path handling
// misreads a Windows drive letter as a URL protocol).
function resolveLogoBuffer(): Buffer | null {
  const abs = path.join(process.cwd(), "public", COMPANY_INFO.logoPath.replace(/^\//, ""));
  if (!fs.existsSync(abs)) return null;
  try {
    return fs.readFileSync(abs);
  } catch {
    return null;
  }
}

const TONES: Record<ReportTone, { bg: string; fg: string }> = {
  office: { bg: "#dcfce7", fg: "#166534" },
  wfh: { bg: "#e0f2fe", fg: "#075985" },
  mixed: { bg: "#ccfbf1", fg: "#115e59" },
  half: { bg: "#fef3c7", fg: "#92400e" },
  comp: { bg: "#ede9fe", fg: "#5b21b6" },
  absent: { bg: "#fee2e2", fg: "#991b1b" },
  paid_leave: { bg: "#fce7f3", fg: "#9d174d" },
  unpaid_leave: { bg: "#ffedd5", fg: "#9a3412" },
  holiday: { bg: "#e2e8f0", fg: "#334155" },
  off: { bg: "#f1f5f9", fg: "#64748b" },
  live: { bg: "#dbeafe", fg: "#1e40af" },
  pending: { bg: "#ffffff", fg: "#374151" },
  none: { bg: "#ffffff", fg: "#9ca3af" },
};

const INK = "#111827";
const MUTED = "#6b7280";
const RULE = "#e5e7eb";
const BRAND = "#0f766e";

const styles = StyleSheet.create({
  page: { paddingTop: 26, paddingBottom: 34, paddingHorizontal: 28, fontSize: 8, fontFamily: "Helvetica", color: INK },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingBottom: 8, borderBottom: `1.5 solid ${BRAND}` },
  logoWrap: { width: 132, height: 26, overflow: "hidden", position: "relative" },
  logo: { width: 132, height: 132, position: "absolute", top: -52, left: 0 },
  companyName: { fontSize: 13, fontWeight: 700 },
  headerRight: { alignItems: "flex-end" },
  kicker: { fontSize: 7, color: MUTED, textTransform: "uppercase", letterSpacing: 1 },
  monthTitle: { fontSize: 15, fontWeight: 700, marginTop: 1 },

  empCard: { marginTop: 9, border: `1 solid ${RULE}`, borderRadius: 5, padding: 8 },
  // Employee page, sized so a 31-day month and its notes fit on ONE A4 page.
  idStrip: { flexDirection: "row", alignItems: "flex-start", marginTop: 8, border: `1 solid ${RULE}`, borderRadius: 5, paddingVertical: 6, paddingHorizontal: 8 },
  idLeft: { width: "32%", paddingRight: 8 },
  idContact: { fontSize: 6.8, color: MUTED, marginTop: 2 },
  miniRow: { flexDirection: "row", marginTop: 6 },
  mini: { flex: 1, border: `1 solid ${RULE}`, borderRadius: 4, paddingVertical: 4, paddingHorizontal: 5, marginRight: 4, minHeight: 44 },
  miniLabel: { fontSize: 6, color: MUTED },
  miniValue: { fontSize: 11.5, fontWeight: 700, marginTop: 1 },
  miniSub: { fontSize: 6, color: MUTED, marginTop: 1 },
  miniSplit: { flexDirection: "row", alignItems: "center", marginTop: 1 },
  dot: { width: 4, height: 4, borderRadius: 2, marginRight: 2.5, marginTop: 1 },
  noteRow: { flexDirection: "row", marginTop: 6 },
  noteBox: { flex: 1, borderRadius: 4, paddingVertical: 4, paddingHorizontal: 6 },
  noteLedger: { backgroundColor: "#f5f3ff", border: "1 solid #ddd6fe", marginRight: 6 },
  noteWarn: { backgroundColor: "#fffbeb", border: "1 solid #fde68a" },
  noteTitle: { fontSize: 7, fontWeight: 700, marginBottom: 1.5 },
  noteText: { fontSize: 6.7, lineHeight: 1.35 },
  empTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 6 },
  empName: { fontSize: 13, fontWeight: 700 },
  empRole: { fontSize: 8, color: MUTED, marginTop: 1 },
  empCount: { fontSize: 7, color: MUTED },
  detailRow: { flexDirection: "row", marginTop: 3 },
  detail: { flex: 1, paddingRight: 6 },
  detailLabel: { fontSize: 6.5, color: MUTED, textTransform: "uppercase", letterSpacing: 0.5 },
  detailValue: { fontSize: 8, fontWeight: 700, marginTop: 1 },

  tiles: { flexDirection: "row", marginTop: 7 },
  tile: { flex: 1, border: `1 solid ${RULE}`, borderRadius: 4, paddingVertical: 4, paddingHorizontal: 6, marginRight: 5 },
  tileLast: { marginRight: 0 },
  tileLabel: { fontSize: 6.5, color: MUTED },
  tileValue: { fontSize: 13, fontWeight: 700, marginTop: 1 },
  tileSub: { fontSize: 6, color: MUTED, marginTop: 1 },
  tileStrong: { backgroundColor: BRAND, border: `1 solid ${BRAND}` },

  sectionTitle: { fontSize: 8.5, fontWeight: 700, marginTop: 9, marginBottom: 3 },
  table: { border: `1 solid ${RULE}`, borderRadius: 4, overflow: "hidden" },
  thead: { flexShrink: 0, flexDirection: "row", backgroundColor: "#f3f4f6", borderBottom: `1 solid ${RULE}` },
  th: { fontSize: 6.8, fontWeight: 700, color: "#374151", paddingVertical: 3, paddingHorizontal: 4 },
  tr: { flexDirection: "row", borderBottom: `0.5 solid ${RULE}`, alignItems: "center", height: 14.2, flexShrink: 0 },
  trAlt: { backgroundColor: "#fafafa" },
  // A part-timer's week, as its quota was judged — under the week's last day.
  weekRow: { flexDirection: "row", alignItems: "center", height: 12.5, flexShrink: 0, backgroundColor: "#eef2ff", borderBottom: `0.5 solid #c7d2fe`, paddingHorizontal: 4 },
  weekText: { fontSize: 6.6, color: "#3730a3", fontWeight: 700 },
  td: { fontSize: 7.4, paddingHorizontal: 4 },
  statusPill: { fontSize: 7, fontWeight: 700, paddingVertical: 1.2, paddingHorizontal: 4, borderRadius: 2.5 },

  ledger: { marginTop: 6, backgroundColor: "#f5f3ff", border: "1 solid #ddd6fe", borderRadius: 4, padding: 5 },
  ledgerTitle: { fontSize: 7.2, fontWeight: 700, color: "#5b21b6", marginBottom: 1.5 },
  ledgerText: { fontSize: 7, color: "#4c1d95", lineHeight: 1.35 },

  // Summary page (landscape)
  sumKpis: { flexDirection: "row", marginTop: 8 },
  sumSection: { fontSize: 8.5, fontWeight: 700, marginTop: 9, marginBottom: 3 },
  sumTable: { border: `1 solid ${RULE}`, borderRadius: 4 },
  sumHead: { flexDirection: "row", backgroundColor: "#f3f4f6", borderBottom: `1 solid ${RULE}`, paddingVertical: 4, flexShrink: 0 },
  sumTh: { fontSize: 6.8, fontWeight: 700, color: "#374151", paddingHorizontal: 4 },
  sumTr: { flexDirection: "row", borderBottom: `0.5 solid ${RULE}`, alignItems: "center", paddingVertical: 3, flexShrink: 0 },
  sumTotal: { flexDirection: "row", backgroundColor: "#f0fdfa", borderTop: `1 solid ${BRAND}`, alignItems: "center", paddingVertical: 3.5, flexShrink: 0 },
  sumMain: { fontSize: 8.2 },
  formula: { fontSize: 6.8, color: MUTED, marginTop: 3 },
  sumSub: { fontSize: 6.4, color: MUTED, marginTop: 1.5 },
  checkStrip: { flexDirection: "row", alignItems: "center", marginTop: 8, backgroundColor: "#fffbeb", border: "1 solid #fde68a", borderRadius: 4, paddingVertical: 5, paddingHorizontal: 8 },
  sumSectionBox: { marginTop: 8, borderRadius: 4, paddingVertical: 6, paddingHorizontal: 8 },
  blockGrid: { flexDirection: "row", flexWrap: "wrap" },
  block: { width: "33.33%", paddingRight: 10, marginTop: 4 },
  cardWarn: { backgroundColor: "#fffbeb", border: "1 solid #fde68a" },
  cardLedger: { backgroundColor: "#f5f3ff", border: "1 solid #ddd6fe" },
  sumCardTitle: { fontSize: 8.4, fontWeight: 700, marginBottom: 3 },
  sumCardRow: { marginTop: 4 },
  sumCardName: { fontSize: 7.6, fontWeight: 700, color: INK },
  sumCardText: { fontSize: 7.2, color: "#374151", lineHeight: 1.4 },

  flags: { marginTop: 6, backgroundColor: "#fffbeb", border: "1 solid #fde68a", borderRadius: 4, padding: 5 },
  flagText: { fontSize: 7, color: "#92400e", lineHeight: 1.35 },

  footer: { position: "absolute", bottom: 14, left: 28, right: 28, flexDirection: "row", justifyContent: "space-between", fontSize: 6.5, color: MUTED, borderTop: `0.5 solid ${RULE}`, paddingTop: 4 },
});

// Column widths, percent of the table. Date | Status | In | Out | Hours | Place | Pay | Note
const COLS = { date: "9%", status: "16%", inn: "8%", out: "8%", hours: "8%", place: "8%", pay: "7%", note: "36%" } as const;

function num(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

function hrs(h: number | null | undefined): string {
  if (h == null) return "—";
  const minutes = Math.round(h * 60);
  if (minutes <= 0) return "0h";
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  if (hh === 0) return `${mm}m`;
  return mm === 0 ? `${hh}h` : `${hh}h ${mm}m`;
}

/** Rows are fixed-height so a 31-day month stays on one page — a note that wrapped
 *  would spill out of its row, so a long one is cut instead. */
const NOTE_MAX = 56;
function clip(note: string | null): string {
  if (!note) return "";
  return note.length > NOTE_MAX ? `${note.slice(0, NOTE_MAX - 1)}…` : note;
}

function longDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

function employmentLabel(e: AttendanceReportEmployee["employee"]): string {
  const type = e.employmentType === "fulltime" ? "Full-time" : e.employmentType === "parttime" ? "Part-time" : "Intern";
  return e.employmentType !== "fulltime" && e.requiredDaysPerWeek ? `${type} · ${e.requiredDaysPerWeek} days/week` : type;
}

function Tile({ label, value, sub, strong, last }: { label: string; value: string; sub?: string; strong?: boolean; last?: boolean }) {
  return (
    <View style={[styles.tile, last ? styles.tileLast : {}, strong ? styles.tileStrong : {}]}>
      <Text style={[styles.tileLabel, strong ? { color: "#ccfbf1" } : {}]}>{label}</Text>
      <Text style={[styles.tileValue, strong ? { color: "#ffffff" } : {}]}>{value}</Text>
      {sub ? <Text style={[styles.tileSub, strong ? { color: "#99f6e4" } : {}]}>{sub}</Text> : null}
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "18 Sep" — fixed three-letter months (the locale's own gives "Sept" for one month only). */
function shortDate(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]}`;
}

function monthOf(iso: string): string {
  return MONTH_NAMES[Number(iso.slice(5, 7)) - 1]!;
}

/** Where a make-up is paid, when the missed day was in another month. */
function paidWhere(g: MadeUpGroup, reportMonth: string | undefined): string {
  const missedMonth = (g.weekStart ?? g.missedDate).slice(0, 7);
  if (g.ons.every((o) => o.slice(0, 7) === g.missedDate.slice(0, 7))) return "";
  if (g.ons.every((o) => o.slice(0, 7) === reportMonth)) return missedMonth !== reportMonth ? ` — paid in ${monthOf(g.ons[0]!)}` : "";
  return ` — paid in ${[...new Set(g.ons.map(monthOf))].join(" and ")}`;
}

// Summary table columns (percent of the table width). Every cell is two lines: the
// figure, and under it what it is made of in words — no codes to decode.
//
// Laid out so a row ADDS UP from left to right (owner, 2026-11-01: "the days worked
// don't add up"): office days + WFH days (half = ½) − worked but not paid + paid leave
// + holidays + compensation = payable days.
const SUM = [
  { key: "name", label: "Employee", w: "15%" },
  { key: "office", label: "Office days", w: "8%" },
  { key: "wfh", label: "WFH days", w: "8%" },
  { key: "notPaid", label: "Worked, not paid", w: "11%" },
  { key: "absent", label: "Absent", w: "7%" },
  { key: "leave", label: "Leave paid/unpaid", w: "9.5%" },
  { key: "hol", label: "Holidays", w: "5.5%" },
  { key: "comp", label: "Comp.", w: "6.5%" },
  { key: "late", label: "Late", w: "4%" },
  { key: "hours", label: "Hours worked", w: "11.5%" },
  { key: "pay", label: "Payable days", w: "7.5%" },
  { key: "bal", label: "Balance left", w: "6.5%" },
] as const;

/** "11", "11 + 2 half" style figure for full + half days. */
function daysCell(full: number, half: number): { main: string; sub?: string } {
  return { main: num(full), sub: half > 0 ? `+ ${num(half)} half day${half === 1 ? "" : "s"}` : undefined };
}

/** Why some worked days are not paid. */
function notPaidWhy(s: AttendanceReportEmployee["summary"]): string | undefined {
  return (
    [
      s.banked > 0 && `${num(s.banked)} in advance`,
      s.wfhOnlyFull > 0 && `${num(s.wfhOnlyFull)} WFH-only`,
      s.wfhOnlyHalf > 0 && `${num(s.wfhOnlyHalf)} WFH-only ½`,
      s.overQuotaHalf > 0 && `${num(s.overQuotaHalf)} over-quota ½`,
    ]
      .filter(Boolean)
      .join(" · ") || undefined
  );
}

type SumKey = (typeof SUM)[number]["key"];
type Cell = { main: string; sub?: string; tone?: "alert" | "strong" | "muted" };

function plural(n: number, word: string): string {
  return `${num(n)} ${word}${n === 1 ? "" : "s"}`;
}

function summaryCells(r: AttendanceReportEmployee): Record<SumKey, Cell> {
  const s = r.summary;
  const e = r.employee;
  const usable = r.balanceAvailable.filter((b) => b.usable);
  const wfhOnlyBal = r.balanceAvailable.length - usable.length;
  const join = (...parts: (string | null | false)[]) => parts.filter(Boolean).join(" · ") || undefined;
  return {
    name: { main: e.fullName, sub: employmentLabel(e), tone: "strong" },
    office: daysCell(s.officeFull, s.officeHalf),
    wfh: daysCell(s.wfhFull, s.wfhHalf),
    notPaid: { main: num(s.unpaidWork), sub: notPaidWhy(s) },
    hol: { main: num(s.holidays) },
    absent: {
      main: num(s.absent),
      sub: join(s.madeUpAbsent > 0 && `${num(s.madeUpAbsent)} made up`),
      tone: s.absent > s.madeUpAbsent ? "alert" : undefined,
    },
    leave: {
      main: `${num(s.paidLeave)} / ${num(s.unpaidLeave)}`,
      sub: join(s.balanceUsed > 0 && `${plural(s.balanceUsed, "balance day")} used`),
    },
    comp: { main: num(s.compensation), sub: join(s.compensation > 0 && "made up") },
    late: { main: num(s.late) },
    hours: { main: hrs(s.hours.total), sub: `${hrs(s.hours.office)} office · ${hrs(s.hours.wfh)} WFH` },
    pay: { main: num(s.payableDays), sub: s.daysOwed != null ? `of ${num(s.daysOwed)} owed` : undefined, tone: "strong" },
    bal: {
      main: String(usable.length),
      sub: join(
        usable.length > 0 && `next by ${shortDate(usable.map((b) => b.expires).sort()[0]!)}`,
        wfhOnlyBal > 0 && `+${wfhOnlyBal} WFH-only`,
      ),
    },
  };
}

function SumCell({ cell, w }: { cell: Cell; w: string }) {
  return (
    <View style={{ width: w, paddingHorizontal: 4 }}>
      <Text
        style={[
          styles.sumMain,
          cell.tone === "strong" ? { fontWeight: 700 } : {},
          cell.tone === "alert" ? { color: "#b91c1c", fontWeight: 700 } : {},
        ]}
       
      >
        {cell.main}
      </Text>
      {cell.sub ? (
        <Text style={styles.sumSub}>
          {cell.sub}
        </Text>
      ) : null}
    </View>
  );
}


function SummaryPage({
  employees,
  monthLabel,
  generatedAt,
  generatedBy,
  logo,
}: {
  employees: AttendanceReportEmployee[];
  monthLabel: string;
  generatedAt: string;
  generatedBy: string | null;
  logo: Buffer | null;
}) {
  const sum = (f: (r: AttendanceReportEmployee) => number) => employees.reduce((a, r) => a + f(r), 0);
  const t = {
    payable: sum((r) => r.summary.payableDays),
    present: sum((r) => r.summary.present),
    banked: sum((r) => r.summary.banked),
    wfhOnly: sum((r) => r.summary.wfhOnly),
    absent: sum((r) => r.summary.absent),
    madeUpAbsent: sum((r) => r.summary.madeUpAbsent),
    paidLeave: sum((r) => r.summary.paidLeave),
    unpaidLeave: sum((r) => r.summary.unpaidLeave),
    balanceUsed: sum((r) => r.summary.balanceUsed),
    compensation: sum((r) => r.summary.compensation),
    late: sum((r) => r.summary.late),
    office: sum((r) => r.summary.hours.office),
    wfh: sum((r) => r.summary.hours.wfh),
    balanceLeft: sum((r) => r.balanceAvailable.filter((b) => b.usable).length),
  };
  const withAbsence = employees.filter((r) => r.summary.absent > r.summary.madeUpAbsent).length;
  const toCheck = employees.filter((r) => r.flags.length > 0);
  const ledger = employees.filter(
    (r) => r.madeUp.length > 0 || r.balanceAvailable.length > 0 || r.balanceCovers.length > 0,
  );
  const totals: Record<SumKey, Cell> = {
    name: { main: "Total", sub: `${employees.length} employee${employees.length === 1 ? "" : "s"}`, tone: "strong" },
    office: daysCell(sum((r) => r.summary.officeFull), sum((r) => r.summary.officeHalf)),
    wfh: daysCell(sum((r) => r.summary.wfhFull), sum((r) => r.summary.wfhHalf)),
    notPaid: { main: num(sum((r) => r.summary.unpaidWork)) },
    hol: { main: num(sum((r) => r.summary.holidays)) },
    absent: { main: num(t.absent), sub: t.madeUpAbsent > 0 ? `${num(t.madeUpAbsent)} made up` : undefined },
    leave: { main: `${num(t.paidLeave)} / ${num(t.unpaidLeave)}` },
    comp: { main: num(t.compensation) },
    late: { main: num(t.late) },
    hours: { main: hrs(t.office + t.wfh), sub: `${hrs(t.office)} office · ${hrs(t.wfh)} WFH` },
    pay: { main: num(t.payable), tone: "strong" },
    bal: { main: String(t.balanceLeft) },
  };

  return (
    <Page size="A4" orientation="landscape" style={styles.page}>
      <View style={styles.header}>
        {logo ? (
          <View style={styles.logoWrap}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's <Image>, not next/image or <img> */}
            <Image src={logo} style={styles.logo} />
          </View>
        ) : (
          <Text style={styles.companyName}>{COMPANY_INFO.name}</Text>
        )}
        <View style={styles.headerRight}>
          <Text style={styles.kicker}>
            Attendance summary · {employees.length} employee{employees.length === 1 ? "" : "s"}
          </Text>
          <Text style={styles.monthTitle}>{monthLabel}</Text>
        </View>
      </View>

      {/* 1. The month in six numbers. */}
      <View style={styles.sumKpis}>
        <Tile label="Payable days" value={num(t.payable)} sub="what pay is worked out from" strong />
        <Tile
          label="Days worked — office / WFH"
          value={`${num(sum((r) => r.summary.officeFull + r.summary.officeHalf * 0.5))} / ${num(sum((r) => r.summary.wfhFull + r.summary.wfhHalf * 0.5))}`}
          sub={`half day = ½ · ${num(sum((r) => r.summary.unpaidWork))} of them not paid`}
        />
        <Tile
          label="Absent"
          value={num(t.absent)}
          sub={`${plural(withAbsence, "employee")} not made up${t.madeUpAbsent > 0 ? ` · ${num(t.madeUpAbsent)} made up` : ""}`}
        />
        <Tile
          label="Leave paid / unpaid"
          value={`${num(t.paidLeave)} / ${num(t.unpaidLeave)}`}
          sub={t.balanceUsed > 0 ? `${plural(t.balanceUsed, "balance day")} used` : "days"}
        />
        <Tile label="Compensation" value={num(t.compensation)} sub="extra days that made up a missed day" />
        <Tile label="Hours worked" value={hrs(t.office + t.wfh)} sub={`${hrs(t.office)} office · ${hrs(t.wfh)} WFH`} last />
      </View>

      {/* 2. Everyone, one row each. */}
      <View style={[styles.sumTable, { marginTop: 8 }]}>
        <View style={styles.sumHead} fixed>
          {SUM.map((c) => (
            <Text key={c.key} style={[styles.sumTh, { width: c.w }]}>
              {c.label}
            </Text>
          ))}
        </View>
        {employees.map((r, i) => {
          const cells = summaryCells(r);
          return (
            <View key={r.employee.id} style={[styles.sumTr, i % 2 === 1 ? styles.trAlt : {}]} wrap={false}>
              {SUM.map((c) => (
                <SumCell key={c.key} cell={cells[c.key]} w={c.w} />
              ))}
            </View>
          );
        })}
        <View style={styles.sumTotal} wrap={false}>
          {SUM.map((c) => (
            <SumCell key={c.key} cell={{ ...totals[c.key], tone: totals[c.key].tone ?? "strong" }} w={c.w} />
          ))}
        </View>
      </View>
      <Text style={styles.formula}>
        Each row adds up: office days + WFH days (a half day counts ½), minus worked-not-paid, plus paid leave, holidays and
        compensation = payable days. Absent and unpaid leave are not paid.
      </Text>

      {/* 3. What needs a look, and what moved between months. Full-width sections whose
          per-employee blocks sit side by side; only a single block is kept whole, so
          anything that doesn't fit flows on to the next page instead of leaving a gap. */}
      {toCheck.length === 0 ? (
        <View style={styles.checkStrip} wrap={false}>
          <Text style={[styles.sumCardTitle, { color: "#92400e", marginBottom: 0 }]}>Check before paying</Text>
          <Text style={[styles.sumCardText, { marginLeft: 8 }]}>
            Nothing unusual — no very long days, no days awaiting approval.
          </Text>
        </View>
      ) : (
        <View style={[styles.sumSectionBox, styles.cardWarn]}>
          <Text style={[styles.sumCardTitle, { color: "#92400e" }]}>Check before paying</Text>
          <View style={styles.blockGrid}>
            {toCheck.map((r) => (
              <View key={r.employee.id} style={[styles.block, { width: "50%" }]} wrap={false}>
                <Text style={styles.sumCardName}>{r.employee.fullName}</Text>
                {r.flags.map((f) => (
                  <Text key={f} style={styles.sumCardText}>
                    • {f}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </View>
      )}

      <View style={[styles.sumSectionBox, styles.cardLedger]}>
        <Text style={[styles.sumCardTitle, { color: "#5b21b6" }]}>Balance days &amp; make-ups</Text>
        {ledger.length === 0 ? (
          <Text style={styles.sumCardText}>No make-ups and no balance days this month.</Text>
        ) : (
          <View style={styles.blockGrid}>
            {ledger.map((r) => {
              const usable = r.balanceAvailable.filter((b) => b.usable);
              const wfhOnly = r.balanceAvailable.length - usable.length;
              return (
                <View key={r.employee.id} style={styles.block} wrap={false}>
                  <Text style={styles.sumCardName}>{r.employee.fullName}</Text>
                  {groupMadeUp(r.madeUp).map((g) => (
                    <Text key={`${g.ons.join(",")}-${g.missedDate}`} style={styles.sumCardText}>
                      • {madeUpSentence(g)}
                      {paidWhere(g, r.days[0]?.date.slice(0, 7))}
                    </Text>
                  ))}
                  {r.balanceCovers.map((c) => (
                    <Text key={c.date} style={styles.sumCardText}>
                      • {shortDate(c.date)} paid from the balance day of {shortDate(c.earned)}
                    </Text>
                  ))}
                  <Text style={styles.sumCardText}>
                    • Balance left:{" "}
                    {usable.length === 0
                      ? "none"
                      : usable.map((b) => `${shortDate(b.earned)} (use by ${shortDate(b.expires)})`).join(", ")}
                    {wfhOnly > 0 ? ` · ${wfhOnly} WFH-earned (covers WFH days only)` : ""}
                  </Text>
                </View>
              );
            })}
          </View>
        )}
      </View>

      <View style={styles.footer} fixed>
        <Text>Summary of the pages that follow — one page per employee, every day listed.</Text>
        <Text>
          Generated {new Date(generatedAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}
          {generatedBy ? ` by ${generatedBy}` : ""} · Pikorua HRM
        </Text>
      </View>
    </Page>
  );
}

function DayRow({ day, alt }: { day: ReportDay; alt: boolean }) {
  const tone = TONES[day.tone];
  const quiet = day.tone === "none" || day.tone === "off";
  return (
    <View style={[styles.tr, alt ? styles.trAlt : {}]} wrap={false}>
      <Text style={[styles.td, { width: COLS.date, fontWeight: 700 }]}>
        {day.date.slice(8)} {day.weekday}
      </Text>
      <View style={{ width: COLS.status, paddingHorizontal: 4 }}>
        {day.statusLabel === "—" ? (
          <Text style={[styles.td, { color: "#d1d5db", paddingHorizontal: 0 }]}>—</Text>
        ) : (
          <Text style={[styles.statusPill, { backgroundColor: tone.bg, color: tone.fg, alignSelf: "flex-start" }]}>
            {day.statusLabel}
          </Text>
        )}
      </View>
      <Text style={[styles.td, { width: COLS.inn }, quiet ? { color: MUTED } : {}]}>{day.clockIn ?? ""}</Text>
      <Text style={[styles.td, { width: COLS.out }, quiet ? { color: MUTED } : {}]}>{day.clockOut ?? ""}</Text>
      <Text style={[styles.td, { width: COLS.hours }]}>{day.hours != null ? hrs(day.hours) : ""}</Text>
      <Text style={[styles.td, { width: COLS.place, color: MUTED }]}>{day.place ?? ""}</Text>
      <Text style={[styles.td, { width: COLS.pay, fontWeight: 700 }]}>{day.credit != null && day.credit > 0 ? num(day.credit) : ""}</Text>
      <Text style={[styles.td, { width: COLS.note, color: MUTED, fontSize: 6.8 }]}>
        {clip(day.note)}
      </Text>
    </View>
  );
}

/** A compact total for the one-row strip on an employee page. */
function MiniTile({
  label,
  value,
  sub,
  split,
  strong,
  wide,
}: {
  label: string;
  value: string;
  sub?: string;
  /** Where these days were worked, like the attendance page's tiles. */
  split?: { office: number; wfh: number };
  strong?: boolean;
  wide?: boolean;
}) {
  const showSplit = split && split.office + split.wfh > 0;
  return (
    <View style={[styles.mini, wide ? { flex: 1.6 } : {}, strong ? styles.tileStrong : {}]}>
      <Text style={[styles.miniLabel, strong ? { color: "#ccfbf1" } : {}]}>{label}</Text>
      <Text style={[styles.miniValue, strong ? { color: "#ffffff" } : {}]}>{value}</Text>
      {showSplit ? (
        <>
          <View style={styles.miniSplit}>
            <View style={[styles.dot, { backgroundColor: "#10b981" }]} />
            <Text style={styles.miniSub}>{num(split.office)} office</Text>
          </View>
          <View style={styles.miniSplit}>
            <View style={[styles.dot, { backgroundColor: "#0ea5e9" }]} />
            <Text style={styles.miniSub}>{num(split.wfh)} WFH</Text>
          </View>
        </>
      ) : null}
      {sub ? <Text style={[styles.miniSub, strong ? { color: "#99f6e4" } : {}]}>{sub}</Text> : null}
    </View>
  );
}

/** Lines in each box at the foot of an employee page. A month rarely has more; the
 *  rest is on the summary page, so the page always stays one page. */
const NOTE_LINES = 6;

function NoteBox({ title, lines, tone }: { title: string; lines: string[]; tone: "ledger" | "warn" }) {
  const shown = lines.length > NOTE_LINES ? lines.slice(0, NOTE_LINES - 1) : lines;
  const more = lines.length - shown.length;
  const color = tone === "ledger" ? "#4c1d95" : "#92400e";
  return (
    <View style={[styles.noteBox, tone === "ledger" ? styles.noteLedger : styles.noteWarn]}>
      <Text style={[styles.noteTitle, { color: tone === "ledger" ? "#5b21b6" : "#92400e" }]}>{title}</Text>
      {shown.map((l) => (
        <Text key={l} style={[styles.noteText, { color }]}>
          • {l}
        </Text>
      ))}
      {more > 0 ? <Text style={[styles.noteText, { color, fontWeight: 700 }]}>+{more} more — see the summary page</Text> : null}
    </View>
  );
}

function EmployeePage({
  report,
  index,
  total,
  monthLabel,
  generatedAt,
  generatedBy,
  logo,
}: {
  report: AttendanceReportEmployee;
  index: number;
  total: number;
  monthLabel: string;
  generatedAt: string;
  generatedBy: string | null;
  logo: Buffer | null;
}) {
  const { employee: e, summary: s } = report;
  const place = [e.departmentName, e.teamName].filter(Boolean).join(" · ");
  const flexible = e.employmentType !== "fulltime" && !!e.requiredDaysPerWeek;

  const ledgerLines = [
    ...groupMadeUp(report.madeUp).map((g) => `${madeUpSentence(g)}${paidWhere(g, report.days[0]?.date.slice(0, 7))}`),
    ...report.balanceCovers.map((c) => `${shortDate(c.date)} paid from the balance day of ${shortDate(c.earned)}`),
    `Balance left: ${
      report.balanceAvailable.length === 0
        ? "none"
        : report.balanceAvailable
            .map((b) => `${shortDate(b.earned)}${b.usable ? "" : " (WFH — covers WFH days only)"}, use by ${shortDate(b.expires)}`)
            .join("; ")
    }`,
  ];
  const showLedger = report.madeUp.length > 0 || report.balanceAvailable.length > 0 || s.banked > 0 || s.balanceUsed > 0;

  return (
    <Page size="A4" style={styles.page}>
      <View style={styles.header}>
        {logo ? (
          <View style={styles.logoWrap}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's <Image>, not next/image or <img> */}
            <Image src={logo} style={styles.logo} />
          </View>
        ) : (
          <Text style={styles.companyName}>{COMPANY_INFO.name}</Text>
        )}
        <View style={styles.headerRight}>
          <Text style={styles.kicker}>
            Attendance report · {index + 1} of {total}
          </Text>
          <Text style={styles.monthTitle}>{monthLabel}</Text>
        </View>
      </View>

      {/* Who: one strip — name and contact on the left, the facts pay depends on right. */}
      <View style={styles.idStrip}>
        <View style={styles.idLeft}>
          <Text style={styles.empName}>{e.fullName}</Text>
          <Text style={styles.empRole}>
            {e.role.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())} · {employmentLabel(e)}
          </Text>
          <Text style={styles.idContact}>
            {e.email}
            {e.phone ? ` · ${e.phone}` : ""}
          </Text>
        </View>
        <Detail label="Department / team" value={place || "—"} />
        <Detail label="Joined" value={longDate(e.dateOfJoining)} />
        <Detail label="Weekly off" value={flexible ? "Flexible" : e.weeklyOff} />
        <Detail
          label="Work from home"
          value={!e.wfhAllowed ? "Not allowed" : e.expectedWfhHoursPerWeek ? `${num(e.expectedWfhHoursPerWeek)}h/wk target` : "Allowed"}
        />
      </View>

      {/* The month: every total in one row, pay last. */}
      <View style={styles.miniRow}>
        <MiniTile
          label="Present"
          value={num(s.present)}
          split={s.byStatus.present}
          sub={s.banked > 0 ? `${num(s.banked)} in advance` : undefined}
        />
        <MiniTile label="Half days" value={num(s.half)} split={s.byStatus.half_day} sub={s.overQuotaHalf > 0 ? `${num(s.overQuotaHalf)} over quota` : undefined} />
        <MiniTile label="Absent" value={num(s.absent)} sub={s.madeUpAbsent > 0 ? `${s.madeUpAbsent} made up` : undefined} />
        <MiniTile label="Paid leave" value={num(s.paidLeave)} sub={s.balanceUsed > 0 ? `${num(s.balanceUsed)} balance` : undefined} />
        <MiniTile label="Unpaid" value={num(s.unpaidLeave)} sub={s.madeUpUnpaid > 0 ? `${s.madeUpUnpaid} made up` : undefined} />
        <MiniTile label="Compensation" value={num(s.compensation)} split={s.byStatus.compensation} sub={s.compensation > 0 ? "made up" : undefined} />
        <MiniTile label={flexible ? "Late" : "Holidays · late"} value={flexible ? num(s.late) : `${num(s.holidays)} · ${num(s.late)}`} />
        <MiniTile
          label="Hours"
          value={hrs(s.hours.total)}
          sub={`${hrs(s.hours.office)} office · ${hrs(s.hours.wfh)} WFH${s.wfhOnly > 0 ? ` · ${num(s.wfhOnly)} WFH-only days` : ""}`}
          wide
        />
        <MiniTile
          label="Payable days"
          value={num(s.payableDays)}
          sub={
            s.daysOwed != null
              ? `of ${num(s.daysOwed)} owed`
              : s.unpaidWork > 0
                ? `${num(s.unpaidWork)} worked, not paid`
                : undefined
          }
          strong
          wide
        />
      </View>

      <View style={[styles.table, { marginTop: 8 }]}>
        <View style={styles.thead}>
          <Text style={[styles.th, { width: COLS.date }]}>Date</Text>
          <Text style={[styles.th, { width: COLS.status }]}>Status</Text>
          <Text style={[styles.th, { width: COLS.inn }]}>In</Text>
          <Text style={[styles.th, { width: COLS.out }]}>Out</Text>
          <Text style={[styles.th, { width: COLS.hours }]}>Hours</Text>
          <Text style={[styles.th, { width: COLS.place }]}>Place</Text>
          <Text style={[styles.th, { width: COLS.pay }]}>Pay</Text>
          <Text style={[styles.th, { width: COLS.note }]}>Note</Text>
        </View>
        {report.days.map((d, i) => (
          <Fragment key={d.date}>
            <DayRow day={d} alt={i % 2 === 1} />
            {report.weekLines
              .filter((w) => w.after === d.date)
              .map((w) => (
                <View key={w.text} style={styles.weekRow} wrap={false}>
                  <Text style={styles.weekText}>{w.text}</Text>
                </View>
              ))}
          </Fragment>
        ))}
      </View>

      {(showLedger || report.flags.length > 0) && (
        <View style={styles.noteRow} wrap={false}>
          {showLedger && <NoteBox title="Balance days & make-ups" lines={ledgerLines} tone="ledger" />}
          {report.flags.length > 0 && <NoteBox title="Check before paying" lines={report.flags} tone="warn" />}
        </View>
      )}

      <View style={styles.footer} fixed>
        <Text>Pay = what each day counts toward pay (half day 0.5; in advance 0). Payable = their total. Approved days only.</Text>
        <Text>
          Generated {new Date(generatedAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}
          {generatedBy ? ` by ${generatedBy}` : ""} · Pikorua HRM
        </Text>
      </View>
    </Page>
  );
}

export function AttendanceReportDocument({ month, year, generatedAt, generatedBy, employees }: AttendanceReportInput) {
  const logo = resolveLogoBuffer();
  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;
  return (
    <Document title={`Attendance — ${monthLabel}`} author="Pikorua HRM" creator="Pikorua HRM">
      <SummaryPage
        employees={employees}
        monthLabel={monthLabel}
        generatedAt={generatedAt}
        generatedBy={generatedBy}
        logo={logo}
      />
      {employees.map((report, i) => (
        <EmployeePage
          key={report.employee.id}
          report={report}
          index={i}
          total={employees.length}
          monthLabel={monthLabel}
          generatedAt={generatedAt}
          generatedBy={generatedBy}
          logo={logo}
        />
      ))}
    </Document>
  );
}
