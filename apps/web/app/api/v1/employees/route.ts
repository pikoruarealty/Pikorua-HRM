import crypto from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSession, hashPassword } from "@/lib/auth";
import { FINANCE_ROLES, Role, isLeadRole } from "@/lib/rbac";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { audit, clientIp } from "@/lib/audit";
import { saveUploadedFile } from "@/lib/storage/local";
import { validatePhotoFile, withPhotoPath } from "@/lib/employees/photo";

// Track A. GET /api/v1/employees — role-scoped list. POST — Admin/HR only,
// creates the Employee row and its linked User login in the same call
// (open decision resolved: combined, see docs/TRACK_A_TASKS.md §1.3).

const PUBLIC_SELECT = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  departmentId: true,
  teamId: true,
  role: true,
  dateOfBirth: true,
  dateOfJoining: true,
  deviceUid: true,
  photoUrl: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.EmployeeSelect;

// Salary is golden-rule data: only ever exposed to Admin/HR.
const FINANCE_SELECT = {
  ...PUBLIC_SELECT,
  baseSalary: true,
} satisfies Prisma.EmployeeSelect;

// Onboarding temp password (2026-07-16 fix): previously a fixed "Pk" + 8
// random chars + "!1" — every temp password shared the same prefix/suffix,
// cutting the effective search space down to just the 8-char middle and
// making them fingerprintable. Now: 14 chars drawn from a crypto-secure RNG
// (crypto.randomInt, not Math.random), one required char from each of
// upper/lower/digit guaranteed then shuffled into a random position, no
// fixed characters anywhere. Ambiguous-looking characters (I/l/1/0/O) are
// excluded so a temp password read off a screen/printout is easy to
// transcribe correctly.
const TEMP_PASSWORD_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const TEMP_PASSWORD_LOWER = "abcdefghijkmnpqrstuvwxyz";
const TEMP_PASSWORD_DIGITS = "23456789";
const TEMP_PASSWORD_SYMBOLS = "!@#$%^&*";
const TEMP_PASSWORD_ALL =
  TEMP_PASSWORD_UPPER + TEMP_PASSWORD_LOWER + TEMP_PASSWORD_DIGITS + TEMP_PASSWORD_SYMBOLS;
const TEMP_PASSWORD_LENGTH = 14;

function randomChar(charset: string): string {
  return charset[crypto.randomInt(charset.length)];
}

function generateTempPassword(): string {
  const required = [
    randomChar(TEMP_PASSWORD_UPPER),
    randomChar(TEMP_PASSWORD_LOWER),
    randomChar(TEMP_PASSWORD_DIGITS),
  ];
  const rest = Array.from({ length: TEMP_PASSWORD_LENGTH - required.length }, () =>
    randomChar(TEMP_PASSWORD_ALL),
  );
  const chars = [...required, ...rest];
  // Fisher-Yates shuffle so the guaranteed chars aren't always in the first
  // three positions — crypto.randomInt keeps the shuffle itself unbiased.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return failFor(ErrorCode.UNAUTHENTICATED);
  }

  const { searchParams } = new URL(req.url);
  const departmentIdFilter = searchParams.get("department_id") ?? undefined;
  const teamIdFilter = searchParams.get("team_id") ?? undefined;

  const isFinance = FINANCE_ROLES.includes(session.role);

  if (isFinance) {
    const employees = await prisma.employee.findMany({
      where: {
        ...(departmentIdFilter ? { departmentId: departmentIdFilter } : {}),
        ...(teamIdFilter ? { teamId: teamIdFilter } : {}),
      },
      select: FINANCE_SELECT,
      orderBy: { fullName: "asc" },
    });
    return ok(employees.map(withPhotoPath));
  }

  if (!session.employeeId) {
    return ok([]);
  }

  const viewer = await prisma.employee.findUnique({
    where: { id: session.employeeId },
    select: { teamId: true },
  });

  const isLead = isLeadRole(session.role);

  if (isLead && viewer?.teamId) {
    const employees = await prisma.employee.findMany({
      where: {
        teamId: viewer.teamId,
        ...(departmentIdFilter ? { departmentId: departmentIdFilter } : {}),
      },
      select: PUBLIC_SELECT,
      orderBy: { fullName: "asc" },
    });
    return ok(employees.map(withPhotoPath));
  }

  // Individual contributor (or lead with no team assigned yet): self only.
  const self = await prisma.employee.findUnique({
    where: { id: session.employeeId },
    select: PUBLIC_SELECT,
  });
  return ok(self ? [withPhotoPath(self)] : []);
}

const createSchema = z.object({
  full_name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  department_id: z.string().uuid().optional(),
  team_id: z.string().uuid().optional(),
  role: z.nativeEnum(Role),
  date_of_birth: z.string().optional(),
  date_of_joining: z.string(),
  base_salary: z.coerce.number().positive(),
  device_uid: z.coerce.number().int().optional(),
  password: z.string().min(8).optional(),
});

/** Collapse a FormData into a plain string record (empty fields dropped). */
function formFields(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && value.trim() !== "") out[key] = value;
  }
  return out;
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return failFor(ErrorCode.UNAUTHENTICATED);
  }
  if (!FINANCE_ROLES.includes(session.role)) {
    return failFor(ErrorCode.FORBIDDEN);
  }

  // Since 2026-07-15 a profile photo is REQUIRED at creation, so this route
  // takes multipart/form-data (employee fields as form fields + a `photo`
  // file) instead of JSON — same transport as the documents upload route.
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return failFor(
      ErrorCode.VALIDATION,
      "Request must be multipart/form-data (employee fields + required `photo` image file).",
    );
  }

  const parsed = createSchema.safeParse(formFields(formData));
  if (!parsed.success) {
    return failFor(ErrorCode.VALIDATION, "Missing or invalid employee fields.");
  }
  const d = parsed.data;

  const photo = validatePhotoFile(formData.get("photo"));
  if (!photo.ok) {
    return failFor(ErrorCode.VALIDATION, photo.message);
  }

  if (d.department_id) {
    const dept = await prisma.department.findUnique({ where: { id: d.department_id } });
    if (!dept) return failFor(ErrorCode.VALIDATION, "department_id does not reference an existing department.");
  }
  if (d.team_id) {
    const team = await prisma.team.findUnique({ where: { id: d.team_id } });
    if (!team) return failFor(ErrorCode.VALIDATION, "team_id does not reference an existing team.");
  }

  const existingEmail = await prisma.employee.findUnique({ where: { email: d.email } });
  if (existingEmail) {
    return fail(ErrorCode.CONFLICT, "An employee with this email already exists.", 409);
  }

  const tempPassword = d.password ?? generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  // Save the photo before creating the row so a created employee always has
  // one (an orphaned file from a failed create is harmless on local disk).
  const photoBuffer = Buffer.from(await photo.file.arrayBuffer());
  const { storageKey } = await saveUploadedFile(photoBuffer, `photo${photo.extension}`, "photos");

  const employee = await prisma.employee.create({
    data: {
      photoUrl: storageKey,
      fullName: d.full_name,
      email: d.email,
      phone: d.phone,
      departmentId: d.department_id,
      teamId: d.team_id,
      role: d.role,
      dateOfBirth: d.date_of_birth ? new Date(d.date_of_birth) : undefined,
      dateOfJoining: new Date(d.date_of_joining),
      baseSalary: d.base_salary,
      deviceUid: d.device_uid,
      user: {
        create: {
          email: d.email,
          passwordHash,
          role: d.role,
          // New accounts start on a temp password: force a change at first login.
          mustChangePassword: true,
        },
      },
    },
    select: FINANCE_SELECT,
  });

  await audit({
    action: "employee.create",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "employee",
    entityId: employee.id,
    metadata: { email: d.email, role: d.role },
    ip: clientIp(req),
  });

  return ok(
    {
      ...withPhotoPath(employee),
      // Returned once so HR can hand it to the employee; never stored in plaintext.
      temporaryPassword: d.password ? undefined : tempPassword,
    },
    201,
  );
}
