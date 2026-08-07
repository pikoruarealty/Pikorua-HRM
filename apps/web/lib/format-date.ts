// Consistent dd/mm/yyyy date formatting across the app (owner request,
// 2026-08-08). Plain `.toLocaleDateString()`/`.toLocaleString()` with no
// explicit locale follows the server/browser's default locale, which renders
// mm/dd/yyyy under en-US — forcing "en-GB" here makes every numeric date
// dd/mm/yyyy regardless of runtime locale. Safe to import from both client
// components and server code (Node's `Intl`/`Date`, no DOM dependency), so
// it also covers the react-pdf payslip template.

export function formatDate(input: string | Date | null | undefined): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatDateTime(input: string | Date | null | undefined): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "—";
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${formatDate(d)}, ${time}`;
}
