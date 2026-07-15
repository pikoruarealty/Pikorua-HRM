import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { saveUploadedFile, readUploadedFile } from "@/lib/storage/local";
import { validatePhotoFile, photoApiPath } from "@/lib/employees/photo";
import { audit, clientIp } from "@/lib/audit";

// Track A (2026-07-15). Profile photos.
// GET — any authenticated user: photos are shown wherever a person appears
// (employee list, calendar birthdays, recognition), none of which is
// golden-rule data. PATCH-like replacement via POST — Admin/HR only (also
// used to backfill photos for employees created before the requirement).

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const employee = await prisma.employee.findUnique({
    where: { id: params.id },
    select: { id: true, photoUrl: true },
  });
  if (!employee || !employee.photoUrl) return failFor(ErrorCode.NOT_FOUND, "No photo on file.");

  let bytes: Buffer;
  try {
    bytes = await readUploadedFile(employee.photoUrl);
  } catch {
    return failFor(ErrorCode.NOT_FOUND, "Stored photo is missing.");
  }

  const ext = employee.photoUrl.slice(employee.photoUrl.lastIndexOf(".")).toLowerCase();
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      // Same-URL replacement is possible, so keep caching short and private.
      "Cache-Control": "private, max-age=300",
    },
  });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (!FINANCE_ROLES.includes(session.role)) return failFor(ErrorCode.FORBIDDEN);

  const employee = await prisma.employee.findUnique({
    where: { id: params.id },
    select: { id: true, photoUrl: true },
  });
  if (!employee) return failFor(ErrorCode.NOT_FOUND, "Employee not found.");

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be multipart/form-data.");
  }

  const photo = validatePhotoFile(formData.get("photo"));
  if (!photo.ok) return failFor(ErrorCode.VALIDATION, photo.message);

  const buffer = Buffer.from(await photo.file.arrayBuffer());
  const { storageKey } = await saveUploadedFile(buffer, `photo${photo.extension}`, `photos/${employee.id}`);

  const updated = await prisma.employee.update({
    where: { id: employee.id },
    data: { photoUrl: storageKey },
    select: { id: true, photoUrl: true },
  });

  await audit({
    action: "employee.photo_update",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "employee",
    entityId: employee.id,
    metadata: { replaced: employee.photoUrl != null, bytes: photo.file.size },
    ip: clientIp(req),
  });

  return ok({ id: updated.id, photoUrl: photoApiPath(updated) }, 201);
}
