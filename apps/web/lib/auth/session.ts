import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import type { Role } from "@prisma/client";

// SHARED (Phase 0). Session = a signed JWT stored in an httpOnly cookie.
// getSession() is the single entry point every route/RBAC check uses.

export const SESSION_COOKIE = "pikorua_session";

const DEFAULT_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export type AppSession = {
  userId: string;
  role: Role;
  employeeId: string | null;
};

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SECRET is not set. Copy .env.example to .env and set it.",
    );
  }
  return new TextEncoder().encode(secret);
}

function maxAgeSeconds(): number {
  const fromEnv = Number(process.env.AUTH_SESSION_MAX_AGE);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_MAX_AGE;
}

/** Sign a session JWT for the given user. */
export async function signSession(session: AppSession): Promise<string> {
  const maxAge = maxAgeSeconds();
  return new SignJWT({ role: session.role, employeeId: session.employeeId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.userId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + maxAge)
    .sign(getSecret());
}

/** Sign a session and write it to the httpOnly session cookie. */
export async function createSession(session: AppSession): Promise<void> {
  const token = await signSession(session);
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds(),
  });
}

/** Read + verify the current session, or null if absent/invalid/expired. */
export async function getSession(): Promise<AppSession | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (!payload.sub) return null;
    return {
      userId: payload.sub,
      role: payload.role as Role,
      employeeId: (payload.employeeId as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

/** Clear the session cookie (logout). */
export function destroySession(): void {
  cookies().delete(SESSION_COOKIE);
}
