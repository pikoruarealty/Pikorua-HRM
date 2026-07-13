# CLAUDE.md — Pikorua HRM

Guidance for AI assistants working in this repo.

## What this is
Internal HR system (Next.js App Router + TypeScript + PostgreSQL + Prisma + Tailwind + shadcn/ui). Full spec is in [docs/](docs/) — **read PRD.md, SCHEMA.md, IMPLEMENTATION_PLAN.md, API_SPEC.md before non-trivial work.** Live status is in [progress.md](progress.md); keep it updated.

## Standing rules (do not violate)
1. **Cascading, complete updates.** A change to shared code must be propagated to every dependent (schema → helper → API → UI → seed) — never leave it partial or breaking pre-existing work.
2. **Never bluff.** Don't claim something builds/works/is verified unless it actually is. State unknowns.

## Two-track split (by vertical feature, not FE/BE)
- **Track A** (Umang): employees, departments/teams, attendance, payroll. Routes under `app/api/v1/{employees,attendance,payroll,...}` + matching dashboard/components folders.
- **Track B** (Bhavarth): work-units/tasks, daily planning, requests, recognition, notifications, announcements, docs, events, assets stub.

## Shared foundation (flag the other dev before changing)

**Canonical shared-file list** — this exact list is duplicated in `.githooks/pre-commit` (the git warning hook); keep both in sync if you add to it:

- `prisma/schema.prisma`
- `prisma/seed.ts`
- `apps/web/lib/db/**`
- `apps/web/lib/auth/**`
- `apps/web/lib/rbac/**`
- `apps/web/lib/api/**`
- `apps/web/components/ui/**`
- `apps/web/lib/requests/reimbursements.ts`
- `apps/web/lib/recognition/employee-of-month.ts`
- `package.json` (root)
- `apps/web/package.json`
- `CLAUDE.md`

The two cross-track helper files (`lib/requests/reimbursements.ts`, `lib/recognition/employee-of-month.ts`) are **implemented by Track B**, imported by Track A's payroll — Track B filling in the stub is expected, not a violation. But once the stub becomes a real implementation (no longer throws `NotImplementedError`), flag Umang, since Track A's payroll behavior changes from erroring to actually computing numbers. Keep the function **signatures** stable regardless.

Also flag once (not a hard block) when adding new files under `app/api/v1/employees/**` — e.g. Track B's `GET /employees/:id/points` and `GET/POST /employees/:id/documents` physically live inside Track A's named folder even though Track B owns them.

**AI behavior rule:** before editing any file matching the shared-file list above, stop and tell the user which shared file(s) are about to change and why, before proceeding — this applies even mid-plan-execution, not only when asked ad hoc. A **git pre-commit hook** (`.githooks/pre-commit`) also warns (non-blocking) at commit time if staged files match this list — enable it once per clone with `git config core.hooksPath .githooks` (README has details).

## Conventions
- API responses use `ok()` / `fail()` / `failFor()` from `@/lib/api/response` → `{ data, error }`.
- Auth: `getSession()` from `@/lib/auth`; guard with `requireRole(session, ROLES)` from `@/lib/rbac`.
- **Golden RBAC rule:** salary/incentive/bonus/reimbursement data + leave/reimbursement approval = **Admin/HR only**, ever.
- Never `new PrismaClient()` in feature code — import `prisma` from `@/lib/db/prisma`.
- Server-generate all attendance timestamps; payroll counts **approved** attendance only.

## Deferred (do NOT build in v1)
Biometric device LAN-sync (`device_punch_raw`, device worker), statutory deductions (PF/ESI/TDS), asset management beyond the stub, non-tech incentive automation.
