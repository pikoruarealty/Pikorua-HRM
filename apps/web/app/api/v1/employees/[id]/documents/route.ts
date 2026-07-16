import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { saveUploadedFile } from "@/lib/storage/local";
import type { Role } from "@prisma/client";

// Track B. GET/POST /api/v1/employees/:id/documents — Milestone 3.4.
// Physically lives under Track A's `app/api/v1/employees/` folder — owned
// by Track B (same folder-overlap note as 2.3/2.2); flag Umang, not a
// shared-file-list item.
//
// RBAC (TRACK_B_TASKLIST 3.4): Admin/HR — any employee's documents.
// Employee — self only. Note this is broader on POST than API_SPEC.md §8's
// literal "POST = Admin/HR" line; following the tasklist's explicit DoD
// (self-upload), which is the more specific/recent source for this
// milestone — flagged as an assumption, not a contradiction resolved with
// the stakeholder.
//
// Storage (revised 2026-07-14): files are saved to local disk via
// `lib/storage/local.ts` (deployment target is a single GCP VM, not
// serverless — no S3 dependency needed). POST takes multipart/form-data
// (`docType` field + `file` field) so bytes go straight to this route; the
// `fileUrl` DB column stores an opaque internal storage key, never a
// directly-servable path — GET rewrites it to a route the caller can fetch
// through (`.../documents/:documentId/file`), which re-checks auth on every
// read rather than trusting a bare public URL the way the old S3 design did.

async function loadEmployeeAndAuthorize(
  employeeId: string,
  session: { role: Role; employeeId: string | null },
) {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return { employee: null, authorized: false };

  const isSelf = session.employeeId === employee.id;
  const authorized = isFinanceRole(session.role) || isSelf;
  return { employee, authorized };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const { employee, authorized } = await loadEmployeeAndAuthorize(params.id, session);
  if (!employee) return failFor(ErrorCode.NOT_FOUND);
  if (!authorized) return failFor(ErrorCode.FORBIDDEN);

  const documents = await prisma.employeeDocument.findMany({
    where: { employeeId: employee.id },
    orderBy: { uploadedAt: "desc" },
  });
  return ok(
    documents.map((d) => ({
      ...d,
      fileUrl: `/api/v1/employees/${employee.id}/documents/${d.id}/file`,
    })),
  );
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;

// Allowed document MIME types → canonical extension (mirrors the whitelist the
// file-serve route renders, so nothing servable can be an active-content type
// like SVG/HTML). Anything else is rejected rather than stored.
const ALLOWED_DOC_TYPES: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
};

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const { employee, authorized } = await loadEmployeeAndAuthorize(params.id, session);
  if (!employee) return failFor(ErrorCode.NOT_FOUND);
  if (!authorized) return failFor(ErrorCode.FORBIDDEN);

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be multipart/form-data.");
  }

  const docType = formData.get("docType");
  const file = formData.get("file");
  if (typeof docType !== "string" || !docType.trim()) {
    return failFor(ErrorCode.VALIDATION, "docType is required.");
  }
  if (!(file instanceof File)) {
    return failFor(ErrorCode.VALIDATION, "file is required.");
  }
  if (file.size === 0) {
    return failFor(ErrorCode.VALIDATION, "file is empty.");
  }
  if (file.size > MAX_FILE_BYTES) {
    return failFor(ErrorCode.VALIDATION, "file exceeds the 10MB limit.");
  }
  const canonicalExtension = ALLOWED_DOC_TYPES[file.type];
  if (!canonicalExtension) {
    return failFor(
      ErrorCode.VALIDATION,
      `Unsupported file type "${file.type || "unknown"}". Allowed: PDF, PNG, JPEG, GIF, DOC, DOCX.`,
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  // Store under the canonical extension from the validated MIME type, never the
  // client-supplied filename — the serve route keys its Content-Type off this.
  const { storageKey } = await saveUploadedFile(buffer, `document${canonicalExtension}`, `documents/${employee.id}`);

  const document = await prisma.employeeDocument.create({
    data: {
      employeeId: employee.id,
      docType: docType.trim(),
      fileUrl: storageKey,
    },
  });
  return ok({ ...document, fileUrl: `/api/v1/employees/${employee.id}/documents/${document.id}/file` }, 201);
}
