import fs from "fs";
import path from "path";
import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { COMPANY_INFO } from "@/lib/payroll/company-info";
import type { AttendanceReportEmployee, ReportDay, ReportTone } from "@/lib/attendance/report";

// Attendance report PDF (2026-10-01, owner request): one A4 page per employee —
// their details, the month's totals and every day of the month — laid out like the
// app's own attendance screen (same colours for office / WFH / half-day /
// compensation / absent / leave) so it reads as the same thing printed. Rendered
// server-side by GET /attendance/export via @react-pdf/renderer, like the payslip.
//
// The page is sized to hold a 31-day month on ONE page: rows are fixed-height and
// nothing in the body wraps. Built-in Helvetica has no ₹ glyph (see payslip-pdf.tsx)
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
  empTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 6 },
  empName: { fontSize: 14, fontWeight: 700 },
  empRole: { fontSize: 8, color: MUTED, marginTop: 1, textTransform: "capitalize" },
  empCount: { fontSize: 7, color: MUTED },
  detailRow: { flexDirection: "row", marginTop: 3 },
  detail: { width: "25%", paddingRight: 6 },
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
  thead: { flexDirection: "row", backgroundColor: "#f3f4f6", borderBottom: `1 solid ${RULE}` },
  th: { fontSize: 6.8, fontWeight: 700, color: "#374151", paddingVertical: 3, paddingHorizontal: 4 },
  tr: { flexDirection: "row", borderBottom: `0.5 solid ${RULE}`, alignItems: "center", height: 13.4 },
  trAlt: { backgroundColor: "#fafafa" },
  td: { fontSize: 7.4, paddingHorizontal: 4 },
  statusPill: { fontSize: 7, fontWeight: 700, paddingVertical: 1.2, paddingHorizontal: 4, borderRadius: 2.5 },

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
const NOTE_MAX = 58;
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
      <Text style={[styles.td, { width: COLS.note, color: MUTED, fontSize: 6.8 }]}>{clip(day.note)}</Text>
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
          <Text style={styles.kicker}>Attendance report</Text>
          <Text style={styles.monthTitle}>{monthLabel}</Text>
        </View>
      </View>

      <View style={styles.empCard}>
        <View style={styles.empTop}>
          <View>
            <Text style={styles.empName}>{e.fullName}</Text>
            <Text style={styles.empRole}>{e.role.replace(/_/g, " ")}</Text>
          </View>
          <Text style={styles.empCount}>
            {index + 1} of {total}
          </Text>
        </View>
        <View style={styles.detailRow}>
          <Detail label="Department / team" value={place || "—"} />
          <Detail label="Employment" value={employmentLabel(e)} />
          <Detail label="Date of joining" value={longDate(e.dateOfJoining)} />
          <Detail label="Weekly off" value={e.employmentType !== "fulltime" && e.requiredDaysPerWeek ? "Flexible" : e.weeklyOff} />
        </View>
        <View style={styles.detailRow}>
          <Detail label="Email" value={e.email} />
          <Detail label="Phone" value={e.phone ?? "—"} />
          <Detail
            label="Work from home"
            value={!e.wfhAllowed ? "Not allowed" : e.expectedWfhHoursPerWeek ? `Allowed · ${num(e.expectedWfhHoursPerWeek)}h/wk target` : "Allowed"}
          />
          <Detail label="Expected hours" value={s.expectedHours != null ? `${num(s.expectedHours)}h this month` : "—"} />
        </View>
      </View>

      <View style={styles.tiles}>
        <Tile label="Present" value={num(s.present)} sub={`${num(s.workedDays.office + s.workedDays.wfh)} days worked`} />
        <Tile label="Half-day" value={num(s.half)} />
        <Tile label="Compensation" value={num(s.compensation)} />
        <Tile label="Paid leave" value={num(s.paidLeave)} />
        <Tile label="Unpaid leave" value={num(s.unpaidLeave)} last />
      </View>
      <View style={[styles.tiles, { marginTop: 5 }]}>
        <Tile label="Absent" value={num(s.absent)} />
        <Tile label="Holidays" value={num(s.holidays)} />
        <Tile label="Late (approved)" value={num(s.late)} />
        <Tile
          label="Hours worked"
          value={hrs(s.hours.total)}
          sub={`${hrs(s.hours.office)} office · ${hrs(s.hours.wfh)} WFH`}
        />
        <Tile
          label="Payable days"
          value={num(s.payableDays)}
          sub="present + ½ half + leave + hol. + comp"
          strong
          last
        />
      </View>

      <Text style={styles.sectionTitle}>Day by day</Text>
      <View style={styles.table}>
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
          <DayRow key={d.date} day={d} alt={i % 2 === 1} />
        ))}
      </View>

      {report.flags.length > 0 && (
        <View style={styles.flags} wrap={false}>
          {report.flags.map((f) => (
            <Text key={f} style={styles.flagText}>
              • {f}
            </Text>
          ))}
        </View>
      )}

      <View style={styles.footer} fixed>
        <Text>
          Pay column = days counted toward pay (a half-day is 0.5). Payable days is their total. Approved days only.
        </Text>
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
