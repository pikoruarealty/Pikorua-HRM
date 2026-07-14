import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole } from "@/lib/rbac";
import { failFor, ErrorCode } from "@/lib/api/response";
import { readUploadedFile } from "@/lib/storage/local";

// Track B. GET /api/v1/employees/:id/documents/:docId/file — Milestone 3.4
// (added 2026-07-14 with the S3 -> local-disk storage switch).
// Same RBAC as GET .../documents (Admin/HR any, Employee self) — re-checked
// on every read since the stored `fileUrl` is now an opaque disk key rather
// than a bare public URL.

const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export async function GET(_req: Request, { params }: { params: { id: string; docId: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const employee = await prisma.employee.findUnique({ where: { id: params.id } });
  if (!employee) return failFor(ErrorCode.NOT_FOUND);

  const isSelf = session.employeeId === employee.id;
  if (!isFinanceRole(session.role) && !isSelf) return failFor(ErrorCode.FORBIDDEN);

  const document = await prisma.employeeDocument.findUnique({ where: { id: params.docId } });
  if (!document || document.employeeId !== employee.id) return failFor(ErrorCode.NOT_FOUND);

  let bytes: Buffer;
  try {
    bytes = await readUploadedFile(document.fileUrl);
  } catch {
    return failFor(ErrorCode.NOT_FOUND, "Stored file is missing.");
  }

  const ext = document.fileUrl.slice(document.fileUrl.lastIndexOf(".")).toLowerCase();
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${document.docType.replace(/[^a-zA-Z0-9 ._-]/g, "")}${ext}"`,
    },
  });
}
