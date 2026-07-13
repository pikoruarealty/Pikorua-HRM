import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pikorua HRM",
  description:
    "Internal HR management system — attendance, payroll, task tracking, requests, recognition, and events.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
