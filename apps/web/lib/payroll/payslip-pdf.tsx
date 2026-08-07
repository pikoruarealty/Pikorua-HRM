import fs from "fs";
import path from "path";
import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { COMPANY_INFO } from "@/lib/payroll/company-info";

// Track A (owner request, 2026-08-07). Payslip PDF layout — driven entirely
// by an already-generated/finalized Payslip row, no live math here (the
// numbers on a finalized payslip are the immutable snapshot; see
// lib/payroll/payslip-preview.ts for the computation itself). Rendered
// server-side by GET /payslips/:id/pdf via @react-pdf/renderer (no headless
// browser).

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export type PayslipPdfInput = {
  employee: {
    fullName: string;
    email: string;
    role: string;
    departmentName: string | null;
  };
  payslip: {
    periodMonth: number;
    periodYear: number;
    baseSalary: number;
    earnedBasePay: number;
    presentCount: number;
    halfDayCount: number;
    paidLeaveCount: number;
    holidayCount: number;
    compensationCount: number;
    unpaidLeaveCount: number;
    absentCount: number;
    lateCount: number;
    incentiveAmount: number;
    bonusAmount: number;
    bonusReason: string | null;
    otherAdditionAmount: number | null;
    otherAdditionReason: string | null;
    lateDeductionTotal: number;
    otherDeductionAmount: number | null;
    otherDeductionReason: string | null;
    reimbursementTotal: number;
    netPay: number;
    generatedAt: string;
  };
};

// react-pdf's built-in Helvetica is a standard PDF base font with no ₹
// glyph — rendering "₹" through it produces mojibake (a stray "¹" instead
// of the rupee sign). Use the "Rs." text prefix instead of the symbol so
// every amount renders correctly without embedding a custom font.
function rupees(n: number) {
  return "Rs. " + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// react-pdf's Image also accepts a raw Buffer, which we use instead of a
// plain filesystem path string: its path-src branch runs the string through
// Node's legacy `url.parse`, which misreads a Windows absolute path's drive
// letter ("D:\...") as a URL protocol and rejects it as "non-local" — the
// logo would silently fail to render in every Windows dev/build environment.
// Reading the bytes ourselves sidesteps that path parsing entirely. The file
// may not exist yet (the owner hasn't dropped the logo in) — resolve to null
// rather than fabricate one, and the header just falls back to text-only.
function resolveLogoBuffer(): Buffer | null {
  const abs = path.join(process.cwd(), "public", COMPANY_INFO.logoPath.replace(/^\//, ""));
  if (!fs.existsSync(abs)) return null;
  try {
    return fs.readFileSync(abs);
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 10, fontFamily: "Helvetica", color: "#1a1a1a" },
  header: { flexDirection: "column", alignItems: "center", marginBottom: 12, borderBottom: "2 solid #1a1a1a", paddingBottom: 10 },
  // The source PNG bakes in a lot of transparent padding above/below the
  // mark itself (square 320x320 canvas, visible content only the ~62px band
  // from y=127 to y=189) — window/crop to just that band via an
  // overflow-hidden wrapper instead of rendering the whole blank square.
  logoWrap: { width: 220, height: 43, overflow: "hidden", position: "relative" },
  logo: { width: 220, height: 220, position: "absolute", top: -87, left: 0 },
  companyName: { fontSize: 16, fontWeight: 700, textAlign: "center" },
  tagline: { fontSize: 9, color: "#555", marginTop: 2, textAlign: "center" },
  companyMeta: { fontSize: 8, color: "#555", marginTop: 6, lineHeight: 1.4, textAlign: "center" },
  title: { fontSize: 13, fontWeight: 700, textAlign: "center", marginVertical: 10, textTransform: "uppercase" },
  section: { marginBottom: 12 },
  sectionTitle: { fontSize: 10, fontWeight: 700, marginBottom: 4, color: "#333" },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  label: { color: "#555" },
  value: { fontWeight: 700 },
  grid2: { flexDirection: "row", flexWrap: "wrap" },
  gridItem: { width: "50%", marginBottom: 3 },
  // Attendance summary — boxed stat cards, matching the web preview
  // (payslip-visual.tsx's VisualStat) instead of the plain label/value list
  // the PDF used to fall back to; the two were rendering inconsistently.
  statsRow: { flexDirection: "row", marginBottom: 6 },
  statBox: {
    flex: 1,
    border: "1 solid #ddd",
    borderRadius: 3,
    paddingVertical: 5,
    paddingHorizontal: 4,
    marginRight: 6,
    alignItems: "center",
  },
  statBoxLast: { marginRight: 0 },
  statLabel: { fontSize: 7.5, color: "#666" },
  statValue: { fontSize: 11, fontWeight: 700, marginTop: 2 },
  table: { borderTop: "1 solid #ccc", borderLeft: "1 solid #ccc" },
  tableRow: { flexDirection: "row" },
  tableCellHead: { flex: 1, padding: 4, fontWeight: 700, backgroundColor: "#f2f2f2", borderRight: "1 solid #ccc", borderBottom: "1 solid #ccc" },
  tableCell: { flex: 1, padding: 4, borderRight: "1 solid #ccc", borderBottom: "1 solid #ccc" },
  netPayBox: { marginTop: 14, padding: 10, backgroundColor: "#f2f2f2", flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  netPayLabel: { fontSize: 12, fontWeight: 700 },
  netPayValue: { fontSize: 16, fontWeight: 700 },
  footer: { position: "absolute", bottom: 24, left: 32, right: 32, fontSize: 7.5, color: "#888", textAlign: "center", borderTop: "1 solid #ddd", paddingTop: 6 },
});

export function PayslipPdfDocument({ employee, payslip }: PayslipPdfInput) {
  const logoBuffer = resolveLogoBuffer();
  const monthLabel = `${MONTH_NAMES[payslip.periodMonth - 1]} ${payslip.periodYear}`;

  const earnings = [
    { label: "Earned base pay", amount: payslip.earnedBasePay },
    { label: "Incentive", amount: payslip.incentiveAmount },
    { label: "Bonus" + (payslip.bonusReason ? ` (${payslip.bonusReason})` : ""), amount: payslip.bonusAmount },
    ...(payslip.otherAdditionAmount
      ? [{ label: "Other addition" + (payslip.otherAdditionReason ? ` (${payslip.otherAdditionReason})` : ""), amount: payslip.otherAdditionAmount }]
      : []),
    { label: "Reimbursement", amount: payslip.reimbursementTotal },
  ].filter((r) => r.amount !== 0 || r.label === "Earned base pay");

  const deductions = [
    { label: "Late deduction", amount: payslip.lateDeductionTotal },
    ...(payslip.otherDeductionAmount
      ? [{ label: "Other deduction" + (payslip.otherDeductionReason ? ` (${payslip.otherDeductionReason})` : ""), amount: payslip.otherDeductionAmount }]
      : []),
  ].filter((r) => r.amount !== 0);

  const totalEarnings = earnings.reduce((sum, r) => sum + r.amount, 0);
  const totalDeductions = deductions.reduce((sum, r) => sum + r.amount, 0);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          {/* The logo already contains the name + tagline — only repeat them
              as text when the logo file itself is missing. */}
          {logoBuffer ? (
            <View style={styles.logoWrap}>
              {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's <Image>, not next/image or <img>; no alt prop in its API */}
              <Image src={logoBuffer} style={styles.logo} />
            </View>
          ) : (
            <>
              <Text style={styles.companyName}>{COMPANY_INFO.name}</Text>
              <Text style={styles.tagline}>{COMPANY_INFO.tagline}</Text>
            </>
          )}
          <Text style={styles.companyMeta}>
            {COMPANY_INFO.address}
            {"\n"}
            {COMPANY_INFO.phone} · {COMPANY_INFO.email}
          </Text>
        </View>

        <Text style={styles.title}>Payslip — {monthLabel}</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Employee</Text>
          <View style={styles.grid2}>
            <View style={styles.gridItem}>
              <Text style={styles.label}>Name</Text>
              <Text style={styles.value}>{employee.fullName}</Text>
            </View>
            <View style={styles.gridItem}>
              <Text style={styles.label}>Email</Text>
              <Text style={styles.value}>{employee.email}</Text>
            </View>
            <View style={styles.gridItem}>
              <Text style={styles.label}>Role</Text>
              <Text style={styles.value}>{employee.role.replace(/_/g, " ")}</Text>
            </View>
            <View style={styles.gridItem}>
              <Text style={styles.label}>Department</Text>
              <Text style={styles.value}>{employee.departmentName ?? "—"}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Attendance summary</Text>
          <View style={styles.statsRow}>
            <Stat label="Present" value={payslip.presentCount} />
            <Stat label="Half-day" value={payslip.halfDayCount} />
            <Stat label="Paid leave" value={payslip.paidLeaveCount} />
            <Stat label="Holidays" value={payslip.holidayCount} last />
          </View>
          <View style={styles.statsRow}>
            <Stat label="Compensation" value={payslip.compensationCount} />
            <Stat label="Unpaid leave" value={payslip.unpaidLeaveCount} />
            <Stat label="Absent" value={payslip.absentCount} />
            <Stat label="Late" value={payslip.lateCount} last />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Earnings</Text>
          <View style={styles.table}>
            <View style={styles.tableRow}>
              <Text style={styles.tableCellHead}>Description</Text>
              <Text style={[styles.tableCellHead, { textAlign: "right" }]}>Amount (Rs.)</Text>
            </View>
            {earnings.map((r) => (
              <View style={styles.tableRow} key={r.label}>
                <Text style={styles.tableCell}>{r.label}</Text>
                <Text style={[styles.tableCell, { textAlign: "right" }]}>{rupees(r.amount)}</Text>
              </View>
            ))}
            <View style={styles.tableRow}>
              <Text style={[styles.tableCell, { fontWeight: 700 }]}>Total earnings</Text>
              <Text style={[styles.tableCell, { textAlign: "right", fontWeight: 700 }]}>{rupees(totalEarnings)}</Text>
            </View>
          </View>
        </View>

        {deductions.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Deductions</Text>
            <View style={styles.table}>
              <View style={styles.tableRow}>
                <Text style={styles.tableCellHead}>Description</Text>
                <Text style={[styles.tableCellHead, { textAlign: "right" }]}>Amount (Rs.)</Text>
              </View>
              {deductions.map((r) => (
                <View style={styles.tableRow} key={r.label}>
                  <Text style={styles.tableCell}>{r.label}</Text>
                  <Text style={[styles.tableCell, { textAlign: "right" }]}>{rupees(r.amount)}</Text>
                </View>
              ))}
              <View style={styles.tableRow}>
                <Text style={[styles.tableCell, { fontWeight: 700 }]}>Total deductions</Text>
                <Text style={[styles.tableCell, { textAlign: "right", fontWeight: 700 }]}>
                  {rupees(totalDeductions)}
                </Text>
              </View>
            </View>
          </View>
        )}

        <View style={styles.netPayBox}>
          <Text style={styles.netPayLabel}>Net pay</Text>
          <Text style={styles.netPayValue}>{rupees(payslip.netPay)}</Text>
        </View>

        <Text style={styles.footer}>
          This is a computer-generated payslip and does not require a signature. Generated on{" "}
          {new Date(payslip.generatedAt).toLocaleDateString("en-IN")} via Pikorua HRM.
        </Text>
      </Page>
    </Document>
  );
}

function Stat({ label, value, last }: { label: string; value: number; last?: boolean }) {
  return (
    <View style={last ? [styles.statBox, styles.statBoxLast] : styles.statBox}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}
