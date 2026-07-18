import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { isFinanceRole, isLeadRole } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { redactRequestFinancials } from "@/lib/requests/redact";
import { notifyFinanceUsers } from "@/lib/notifications/push";
import { saveUploadedFile } from "@/lib/storage/local";
import { RequestType, RequestStatus, Role } from "@prisma/client";

// Who may file their own request, in hierarchy order: Employee -> approved by
// Lead's superiors (HR/Admin); Lead -> approved by HR/Admin; HR -> approved by
// Admin (self-approval blocked in approve/reject). Admin has no one above it,
// so Admin is intentionally not included here (would create an unapprovable
// pending request).
const CAN_SUBMIT_ROLES: readonly Role[] = [
  Role.tech_employee,
  Role.sales_employee,
  Role.bde,
  Role.tech_lead,
  Role.sales_lead,
  Role.hr,
];

// Track B. GET/POST /api/v1/requests — Milestone 1.3 (leave) + 2.4 (reimbursement).

const LEAVE_TYPES: RequestType[] = [RequestType.leave_paid, RequestType.leave_unpaid];

// The employee summary shown on every request row so approvers see *who* filed
// it and non-finance viewers still get context. Financial fields are redacted
// separately (see redactRequestFinancials) — this is non-sensitive.
const EMPLOYEE_SUMMARY = {
  select: {
    id: true,
    fullName: true,
    email: true,
    role: true,
    department: { select: { name: true } },
    team: { select: { name: true } },
  },
} as const;

// Reimbursement bill upload: images + PDF only, 10MB cap (matches the employee
// document upload posture). Stored as an opaque local-disk key in
// `Request.attachmentUrl`, served back through GET /requests/:id/attachment.
const ALLOWED_BILL_MIME: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};
const MAX_BILL_BYTES = 10 * 1024 * 1024;

const createSchema = z.object({
  type: z.nativeEnum(RequestType),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  amount: z.number().positive().optional(),
  attachmentUrl: z.string().url().optional(),
  description: z.string().optional(),
});

const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  [RequestType.leave_paid]: "paid leave",
  [RequestType.leave_unpaid]: "unpaid leave",
  [RequestType.reimbursement]: "reimbursement",
  [RequestType.wfh]: "work-from-home",
  [RequestType.other]: "other",
};

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!CAN_SUBMIT_ROLES.includes(session.role)) return failFor(ErrorCode.FORBIDDEN);
  if (!session.employeeId) return failFor(ErrorCode.FORBIDDEN, "Session has no linked employee record.");

  // A reimbursement can carry a bill file, so the submit form posts
  // multipart/form-data; leave requests still post JSON. Accept both.
  const contentType = req.headers.get("content-type") ?? "";
  let raw: Record<string, unknown>;
  let billFile: File | null = null;

  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return failFor(ErrorCode.VALIDATION, "Invalid multipart form data.");
    }
    const maybeFile = form.get("bill");
    if (maybeFile instanceof File && maybeFile.size > 0) billFile = maybeFile;
    raw = {
      type: form.get("type") ?? undefined,
      dateFrom: form.get("dateFrom") || undefined,
      dateTo: form.get("dateTo") || undefined,
      amount: form.get("amount") != null && form.get("amount") !== "" ? Number(form.get("amount")) : undefined,
      description: (form.get("description") as string) || undefined,
    };
  } else {
    try {
      raw = (await req.json()) as Record<string, unknown>;
    } catch {
      return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
    }
  }

  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return failFor(ErrorCode.VALIDATION, "Invalid request body.");
  }
  const { type, dateFrom, dateTo, amount, attachmentUrl, description } = parsed.data;

  if (LEAVE_TYPES.includes(type)) {
    if (!dateFrom || !dateTo) {
      return failFor(ErrorCode.VALIDATION, "dateFrom and dateTo are required for leave requests.");
    }
    if (dateTo < dateFrom) {
      return failFor(ErrorCode.VALIDATION, "dateTo must be on or after dateFrom.");
    }
  } else if (type === RequestType.reimbursement) {
    if (amount === undefined) {
      return failFor(ErrorCode.VALIDATION, "amount is required for reimbursement requests.");
    }
  } else {
    return failFor(ErrorCode.NOT_IMPLEMENTED, "Only leave and reimbursement requests are supported until Milestone 3.");
  }

  // Persist the uploaded bill (reimbursement only) before creating the row so
  // the stored key can go straight into attachmentUrl.
  let storedAttachment: string | undefined = attachmentUrl;
  if (billFile && type === RequestType.reimbursement) {
    const ext = ALLOWED_BILL_MIME[billFile.type];
    if (!ext) {
      return failFor(ErrorCode.VALIDATION, "Bill must be a PDF or image (PDF/PNG/JPEG/GIF/WebP).");
    }
    if (billFile.size > MAX_BILL_BYTES) {
      return failFor(ErrorCode.VALIDATION, "Bill file must be 10MB or smaller.");
    }
    const buffer = Buffer.from(await billFile.arrayBuffer());
    const { storageKey } = await saveUploadedFile(buffer, `bill${ext}`, "request-bills");
    storedAttachment = storageKey;
  }

  const request = await prisma.request.create({
    data: {
      employeeId: session.employeeId,
      type,
      dateFrom: LEAVE_TYPES.includes(type) ? dateFrom : undefined,
      dateTo: LEAVE_TYPES.includes(type) ? dateTo : undefined,
      amount: type === RequestType.reimbursement ? amount : undefined,
      attachmentUrl: type === RequestType.reimbursement ? storedAttachment : undefined,
      description,
      status: RequestStatus.pending,
    },
    include: { employee: EMPLOYEE_SUMMARY },
  });

  // Notify the approver pool (Admin + HR) so a new request surfaces without
  // them polling the page. Skip the submitter (an HR person's own request goes
  // up to Admin, not back to themselves). Fire-and-safe.
  const label = REQUEST_TYPE_LABELS[type];
  await notifyFinanceUsers(
    `${type}_submitted`,
    `${request.employee.fullName} submitted a ${label} request.`,
    "New request to review",
    session.userId,
  );

  return ok(request, 201);
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const { searchParams } = new URL(req.url);
  const typeFilter = searchParams.get("type") as RequestType | null;
  const statusFilter = searchParams.get("status") as RequestStatus | null;
  const employeeIdFilter = searchParams.get("employee_id") ?? undefined;

  const role = session.role;

  if (isFinanceRole(role)) {
    const requests = await prisma.request.findMany({
      where: {
        type: typeFilter ?? undefined,
        status: statusFilter ?? undefined,
        employeeId: employeeIdFilter,
      },
      orderBy: { createdAt: "desc" },
      include: { employee: EMPLOYEE_SUMMARY },
    });
    return ok(requests.map((r) => ({ ...r, hasAttachment: r.attachmentUrl != null })));
  }

  if (!session.employeeId) return ok([]);

  if (isLeadRole(role)) {
    const teams = await prisma.team.findMany({
      where: { teamLeadId: session.employeeId },
      select: { members: { select: { id: true } } },
    });
    // Own team's members plus the Lead's own submitted requests (Leads can
    // now file their own leave, approved up the chain by HR/Admin).
    const scopedEmployeeIds = [...new Set([...teams.flatMap((t) => t.members.map((m) => m.id)), session.employeeId])];

    const requests = await prisma.request.findMany({
      where: {
        employeeId: employeeIdFilter ? employeeIdFilter : { in: scopedEmployeeIds },
        type: typeFilter ?? undefined,
        status: statusFilter ?? undefined,
      },
      orderBy: { createdAt: "desc" },
      include: { employee: EMPLOYEE_SUMMARY },
    });
    // A Lead may only ever see their own team's requests + their own, even via employee_id filter.
    // Reimbursement amount/attachment follow the same "finance or self" rule the
    // attachment route enforces: a Lead sees their OWN reimbursement financials,
    // but a teammate's are stripped (and no "View bill" link, since the bill 403s).
    return ok(
      requests
        .filter((r) => scopedEmployeeIds.includes(r.employeeId))
        .map((r) => {
          const isSelf = r.employeeId === session.employeeId;
          return {
            ...(isSelf ? r : redactRequestFinancials(r)),
            hasAttachment: isSelf && r.attachmentUrl != null,
          };
        }),
    );
  }

  // Employee: self only. The owner filed the request and typed the amount, and
  // can already open their own bill (attachment route allows self) — so show
  // their own financials rather than redacting them.
  const requests = await prisma.request.findMany({
    where: {
      employeeId: session.employeeId,
      type: typeFilter ?? undefined,
      status: statusFilter ?? undefined,
    },
    orderBy: { createdAt: "desc" },
    include: { employee: EMPLOYEE_SUMMARY },
  });
  return ok(
    requests.map((r) => ({ ...r, hasAttachment: r.attachmentUrl != null })),
  );
}
