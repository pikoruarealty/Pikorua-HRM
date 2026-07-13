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

## Shared files (canonical list — flag the other dev before changing)
These are common ground between Track A and Track B. A local `.githooks/pre-commit` warns when a commit touches any of them (opt-in — see README "Contributing"); treat that warning as a reminder, not a substitute for actually flagging the change.

- `prisma/schema.prisma` — single shared migration file (Migration Ownership Rules, IMPLEMENTATION_PLAN.md §6)
- `prisma/seed.ts` — shared seed data
- `apps/web/lib/rbac/` — role guards used by every route in both tracks
- `apps/web/lib/auth/` — session/login/password hashing
- `apps/web/lib/api/response.ts`, `apps/web/lib/errors.ts` — shared `{ data, error }` envelope + error types
- `apps/web/lib/db/` — Prisma client singleton
- `apps/web/components/ui/` — shared shadcn primitives
- `apps/web/lib/requests/reimbursements.ts` — cross-track contract; **Track B implements, Track A only calls** `getApprovedReimbursementTotal()`
- `apps/web/lib/recognition/employee-of-month.ts` — cross-track contract; **Track B implements, Track A only calls** `getEmployeeOfMonthStatus()`

**AI rule:** before editing any file on this list — whether it's the file you were asked to change or one you'd touch as a side effect of a plan already in progress — stop and flag it to the user first. This overrides an in-progress plan; re-confirm even if the file wasn't called out when the plan was approved.

## Conventions
- API responses use `ok()` / `fail()` / `failFor()` from `@/lib/api/response` → `{ data, error }`.
- Auth: `getSession()` from `@/lib/auth`; guard with `requireRole(session, ROLES)` from `@/lib/rbac`.
- **Golden RBAC rule:** salary/incentive/bonus/reimbursement data + leave/reimbursement approval = **Admin/HR only**, ever.
- Never `new PrismaClient()` in feature code — import `prisma` from `@/lib/db/prisma`.
- Server-generate all attendance timestamps; payroll counts **approved** attendance only.

## Deferred (do NOT build in v1)
Biometric device LAN-sync (`device_punch_raw`, device worker), statutory deductions (PF/ESI/TDS), asset management beyond the stub, non-tech incentive automation.
