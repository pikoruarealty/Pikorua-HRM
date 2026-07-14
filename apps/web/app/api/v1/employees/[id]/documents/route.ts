import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
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
// Body takes a `fileUrl` already uploaded to S3/R2 via `lib/storage/s3.ts`'s
// presigned-URL flow (same pattern as Request.attachmentUrl in Milestone 2.4)
// — no file bytes pass through this route.

const createSchema = z.object({
  docType: z.string().min(1),
  fileUrl: z.string().url(),
});

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
  return ok(documents);
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const { employee, authorized } = await loadEmployeeAndAuthorize(params.id, session);
  if (!employee) return failFor(ErrorCode.NOT_FOUND);
  if (!authorized) return failFor(ErrorCode.FORBIDDEN);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return failFor(ErrorCode.VALIDATION, "Invalid request body.");

  const document = await prisma.employeeDocument.create({
    data: {
      employeeId: employee.id,
      docType: parsed.data.docType,
      fileUrl: parsed.data.fileUrl,
    },
  });
  return ok(document, 201);
}
