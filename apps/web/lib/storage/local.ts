import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

// Track B, Milestone 3.4 (revised 2026-07-14). Local-disk file storage —
// replaces the earlier S3/R2 presigned-upload design. Deployment target is a
// single GCP VM, not serverless, so a persistent local disk under the app's
// working directory is simpler and has no cloud dependency. Not on the
// shared-file list (Track B-only infra), but reusable if Track A ever needs
// file storage — flag Umang.
//
// Files are stored outside `public/` (`<cwd>/uploads/`) so nothing is
// directly web-servable without going through an authenticated route — see
// `readUploadedFile` and its callers in `app/api/v1/employees/[id]/documents/**`.

const UPLOAD_ROOT = path.join(process.cwd(), "uploads");

export async function saveUploadedFile(
  buffer: Buffer,
  originalName: string,
  subdir: string,
): Promise<{ storageKey: string }> {
  const ext = path.extname(originalName).replace(/[^a-zA-Z0-9.]/g, "").slice(0, 20);
  const storedName = `${crypto.randomUUID()}${ext}`;
  const dir = path.join(UPLOAD_ROOT, subdir);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, storedName), buffer);
  return { storageKey: path.posix.join(subdir, storedName) };
}

/** Reads a previously-saved file. `storageKey` must come from the database, never directly from a client request — this does not re-sanitize it. */
export async function readUploadedFile(storageKey: string): Promise<Buffer> {
  const full = path.join(UPLOAD_ROOT, storageKey);
  if (!full.startsWith(UPLOAD_ROOT + path.sep) && full !== UPLOAD_ROOT) {
    throw new Error("Invalid storage key.");
  }
  return fs.readFile(full);
}
