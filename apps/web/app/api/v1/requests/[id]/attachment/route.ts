import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole } from "@/lib/rbac";
import { failFor, ErrorCode } from "@/lib/api/response";
import { readUploadedFile } from "@/lib/storage/local";
import { RequestType } from "@prisma/client";

// Track B. GET /api/v1/requests/:id/attachment — streams a reimbursement bill.
// The stored `attachmentUrl` is an opaque local-disk key (never a public URL),
// so access is re-checked here on every read.
//
// RBAC: Admin/HR (they see all reimbursement financials per the golden rule),
// or the submitter viewing their own bill. Leads never see reimbursement
// attachments — same posture as redactRequestFinancials on the JSON routes.

const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const request = await prisma.request.findUnique({ where: { id: params.id } });
  if (!request) return failFor(ErrorCode.NOT_FOUND);
  if (request.type !== RequestType.reimbursement || !request.attachmentUrl) {
    return failFor(ErrorCode.NOT_FOUND, "No attachment on this request.");
  }

  const isSelf = session.employeeId != null && session.employeeId === request.employeeId;
  if (!isFinanceRole(session.role) && !isSelf) return failFor(ErrorCode.FORBIDDEN);

  let bytes: Buffer;
  try {
    bytes = await readUploadedFile(request.attachmentUrl);
  } catch {
    return failFor(ErrorCode.NOT_FOUND, "Stored file is missing.");
  }

  const ext = request.attachmentUrl.slice(request.attachmentUrl.lastIndexOf(".")).toLowerCase();
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="bill${ext}"`,
    },
  });
}
