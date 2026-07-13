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
`prisma/schema.prisma`, `apps/web/lib/{db,auth,rbac,api}`, `apps/web/components/ui`, and the cross-track helper stubs `lib/requests/reimbursements.ts` + `lib/recognition/employee-of-month.ts` (Track A imports these; Track B implements them — keep signatures stable).

## Conventions
- API responses use `ok()` / `fail()` / `failFor()` from `@/lib/api/response` → `{ data, error }`.
- Auth: `getSession()` from `@/lib/auth`; guard with `requireRole(session, ROLES)` from `@/lib/rbac`.
- **Golden RBAC rule:** salary/incentive/bonus/reimbursement data + leave/reimbursement approval = **Admin/HR only**, ever.
- Never `new PrismaClient()` in feature code — import `prisma` from `@/lib/db/prisma`.
- Server-generate all attendance timestamps; payroll counts **approved** attendance only.

## Deferred (do NOT build in v1)
Biometric device LAN-sync (`device_punch_raw`, device worker), statutory deductions (PF/ESI/TDS), asset management beyond the stub, non-tech incentive automation.
