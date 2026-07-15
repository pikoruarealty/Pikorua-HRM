import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createLogger } from "@/lib/log";

// Security headers on every response (production hardening, 2026-07-15).
// A CSP is deliberately NOT set yet: Next 14 App Router inline scripts (and
// the theme no-flash boot script in layout.tsx) would need nonce plumbing to
// avoid 'unsafe-inline', which would make the policy decorative. Tracked as
// a follow-up in progress.md.
//
// Also the request-logging chokepoint (verbose logging, 2026-07-15): every
// request gets one INFO line and an `x-request-id` response header so a
// failure reported by a user can be matched to the surrounding server logs.
const logger = createLogger("http");

export function middleware(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8);
  logger.info(
    `request rid=${requestId} ${req.method} ${req.nextUrl.pathname}${req.nextUrl.search}`,
    {
      ip: req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? undefined,
      ua: req.headers.get("user-agent") ?? undefined,
    },
  );

  const res = NextResponse.next();
  res.headers.set("x-request-id", requestId);
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.NODE_ENV === "production") {
    res.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }
  return res;
}

export const config = {
  // Everything except Next's static assets (headers there are harmless but
  // add latency for no benefit).
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
