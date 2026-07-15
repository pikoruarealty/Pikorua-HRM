import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pikorua HRM",
  description:
    "Internal HR management system — attendance, payroll, task tracking, requests, recognition, and events.",
};

// Set the theme before first paint to avoid a flash of the wrong mode.
const themeScript = `
(function() {
  try {
    var t = localStorage.getItem('theme');
    var m = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (t === 'dark' || (!t && m)) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
