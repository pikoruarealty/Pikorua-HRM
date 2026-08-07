// Track A (owner request, 2026-08-07). Letterhead constants for payslip PDF
// export (lib/payroll/payslip-pdf.tsx). Confirmed by the owner directly —
// not sourced from anywhere else in the codebase.
//
// logoPath points at the official logo (black-text-on-white variant, for the
// PDF letterhead — added 2026-08-07). The PDF template still degrades to
// name/tagline text only if the file is ever missing.
export const COMPANY_INFO = {
  name: "Pikorua Realty",
  tagline: "Good People, Great Properties",
  address: "707, Satyamev Elite, Ambli T-Junction, Ambli Bopal Road, SP Ring Road, Ahmedabad - 380058",
  phone: "+91 63543 59222",
  email: "jitendra.pareek@pikorua.in",
  // Relative to apps/web/public — served at /pikorua-logo.png. Referenced by
  // an absolute URL when rendering the PDF server-side (see payslip-pdf.tsx).
  logoPath: "/pikorua-logo.png",
} as const;
