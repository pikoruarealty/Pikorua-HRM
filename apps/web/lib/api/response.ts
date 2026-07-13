import { NextResponse } from "next/server";

// SHARED (Phase 0). Standard API envelope from API_SPEC.md:
//   success -> { data, error: null }
//   failure -> { data: null, error: { code, message } }
// Every route handler in both tracks returns via these helpers so clients can
// rely on one shape.

export type ApiError = {
  code: string;
  message: string;
};

export type ApiResponse<T> = {
  data: T | null;
  error: ApiError | null;
};

/** Common error codes — extend as needed, keep stable for clients. */
export const ErrorCode = {
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION: "VALIDATION",
  CONFLICT: "CONFLICT",
  INTERNAL: "INTERNAL",
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export function ok<T>(data: T, init?: number | ResponseInit): NextResponse {
  const responseInit = typeof init === "number" ? { status: init } : init;
  return NextResponse.json<ApiResponse<T>>({ data, error: null }, responseInit);
}

export function fail(
  code: ErrorCodeValue | string,
  message: string,
  status = 400,
): NextResponse {
  return NextResponse.json<ApiResponse<never>>(
    { data: null, error: { code, message } },
    { status },
  );
}

/** Map common auth/rbac failures to their conventional HTTP status. */
export function failFor(
  code: (typeof ErrorCode)[keyof typeof ErrorCode],
  message?: string,
): NextResponse {
  const defaults: Record<string, { status: number; message: string }> = {
    UNAUTHENTICATED: { status: 401, message: "Authentication required." },
    FORBIDDEN: { status: 403, message: "You do not have access to this resource." },
    NOT_FOUND: { status: 404, message: "Resource not found." },
    VALIDATION: { status: 422, message: "Invalid request." },
    CONFLICT: { status: 409, message: "Conflicting request." },
    INTERNAL: { status: 500, message: "Something went wrong." },
    NOT_IMPLEMENTED: { status: 501, message: "Not implemented yet." },
  };
  const d = defaults[code];
  return fail(code, message ?? d.message, d.status);
}
