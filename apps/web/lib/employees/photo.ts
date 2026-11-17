// Track A (2026-07-15). Profile-photo helpers shared by the employees routes.
// The DB stores an opaque local-storage key in `employees.photo_url`; API
// responses never expose the key — they expose the authenticated serving
// route instead (same pattern as employee documents).

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** Allowed photo MIME types → canonical extension for storage. */
export const PHOTO_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

export type PhotoValidation =
  | { ok: true; file: File; extension: string }
  | { ok: false; message: string };

export function validatePhotoFile(value: FormDataEntryValue | null): PhotoValidation {
  if (!(value instanceof File) || value.size === 0) {
    return { ok: false, message: "photo is required (a JPEG, PNG, or WebP image file)." };
  }
  const extension = PHOTO_EXTENSIONS[value.type];
  if (!extension) {
    return { ok: false, message: `photo must be JPEG, PNG, or WebP (got "${value.type || "unknown"}").` };
  }
  if (value.size > MAX_PHOTO_BYTES) {
    return { ok: false, message: "photo exceeds the 5MB limit." };
  }
  return { ok: true, file: value, extension };
}

/**
 * Map the stored key to the authenticated serving route (or null). The route's
 * response is cached for a few minutes, and a replacement is served from the
 * same URL — so the (per-upload, random) file name goes on as `?v=` and a new
 * photo is a new URL: it shows up at once instead of after the cache expires.
 * The GET route ignores the query.
 */
export function photoApiPath(employee: { id: string; photoUrl: string | null }): string | null {
  if (!employee.photoUrl) return null;
  const file = employee.photoUrl.slice(employee.photoUrl.lastIndexOf("/") + 1);
  const version = encodeURIComponent(file.replace(/\.[^.]*$/, ""));
  return `/api/v1/employees/${employee.id}/photo?v=${version}`;
}

/** Replace the raw storage key with the servable API path on a response object. */
export function withPhotoPath<T extends { id: string; photoUrl: string | null }>(
  employee: T,
): T {
  return { ...employee, photoUrl: photoApiPath(employee) } as T;
}
