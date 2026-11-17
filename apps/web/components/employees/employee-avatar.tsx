"use client";

import { useState } from "react";

// Profile-photo avatar with an initials fallback (no photo yet, or the
// authenticated photo route 404s). `photoUrl` is the API serving path from
// employee responses, e.g. /api/v1/employees/:id/photo.

const SIZES = {
  sm: "h-8 w-8 text-xs",
  nav: "h-9 w-9 text-sm", // sidebar user chip
  md: "h-12 w-12 text-sm",
  lg: "h-24 w-24 text-2xl",
} as const;

export function EmployeeAvatar({
  fullName,
  photoUrl,
  size = "md",
  firstInitialOnly = false,
}: {
  fullName: string;
  photoUrl: string | null;
  size?: keyof typeof SIZES;
  /** Fallback shows just the first name's first letter (sidebar chip) instead of first + last initials. */
  firstInitialOnly?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const initials = fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, firstInitialOnly ? 1 : 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

  if (photoUrl && !failed) {
    return (
      // Authenticated dynamic route; next/image optimization would re-fetch without cookies.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt={`Photo of ${fullName}`}
        onError={() => setFailed(true)}
        className={`${SIZES[size]} shrink-0 rounded-full object-cover border`}
      />
    );
  }

  return (
    <div
      role="img"
      aria-label={`Initials of ${fullName}`}
      className={`${SIZES[size]} shrink-0 rounded-full border bg-muted flex items-center justify-center font-semibold text-muted-foreground`}
    >
      {initials || "?"}
    </div>
  );
}
