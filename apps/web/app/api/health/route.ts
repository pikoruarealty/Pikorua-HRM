import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

// GET /api/health — unauthenticated liveness/readiness probe for the reverse
// proxy / uptime monitor (production hardening, 2026-07-15). Reports only
// coarse status — no versions, no config, nothing enumerable.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", db: "up" });
  } catch {
    return NextResponse.json({ status: "degraded", db: "down" }, { status: 503 });
  }
}
