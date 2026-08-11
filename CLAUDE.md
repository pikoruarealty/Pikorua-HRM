# CLAUDE.md — Pikorua HRM

Guidance for AI assistants working in this repo.

## What this is
Internal HR system (Next.js App Router + TypeScript + PostgreSQL + Prisma + Tailwind + shadcn/ui). Full spec is in [docs/](docs/) — **read PRD.md, SCHEMA.md, IMPLEMENTATION_PLAN.md, API_SPEC.md before non-trivial work.** Live status is in [progress.md](progress.md); keep it updated.

## Standing rules (do not violate)
1. **Cascading, complete updates.** A change to shared code must be propagated to every dependent (schema → helper → API → UI → seed) — never leave it partial or breaking pre-existing work.
2. **Never bluff.** Don't claim something builds/works/is verified unless it actually is. State unknowns.

## Ownership (single developer as of 2026-08-08)
Bhavarth is the sole developer on this repo. The former **two-track split** (Track A = employees/attendance/payroll, Track B = work/requests/recognition) is **retired** — there is no other dev to coordinate with, so:

- **There is no "flag before editing a shared file" rule anymore.** Edit any file directly, including `prisma/schema.prisma`, `prisma/seed.ts`, `lib/{db,auth,rbac,api}/**`, and `components/ui/**`. Standing rule 1 (cascading, complete updates) still fully applies — these files have many dependents, so changing one still means propagating schema → helper → API → UI → seed.
- The `.githooks/pre-commit` warning hook is **vestigial**; its output is informational only and can be ignored or the hook disabled (`git config --unset core.hooksPath`).
- Track A/B labels still appear in older file headers, `progress.md` entries, and `docs/`. Treat them as historical notes about who wrote a thing, not as boundaries.

**Cross-module helper contracts** (still worth knowing — payroll/attendance import these from the work/requests side; keep the signatures stable, since several call sites depend on them):
- `getApprovedReimbursementTotal()` from `@/lib/requests/reimbursements` — live.
- `getEmployeeOfMonthStatus()` from `@/lib/recognition/employee-of-month` — live.
- `getApprovedUnpaidLeaveDays()` from `@/lib/requests/leave` — live (2026-07-14). Counts approved `leave_unpaid` days clipped to the payroll period; feeds payslip standard deductions.

## Conventions
- API responses use `ok()` / `fail()` / `failFor()` from `@/lib/api/response` → `{ data, error }`.
- Auth: `getSession()` from `@/lib/auth`; guard with `requireRole(session, ROLES)` from `@/lib/rbac`.
- **Golden RBAC rule:** salary/incentive/bonus/reimbursement data + leave/reimbursement approval = **Admin/HR only**, ever.
- Never `new PrismaClient()` in feature code — import `prisma` from `@/lib/db/prisma`.
- Server-generate all attendance timestamps; payroll counts **approved** attendance only.
- **Audit trail (2026-07-15):** any route that mutates financial/sensitive data (payslips, payroll config, attendance edit/approve, request approve/reject, employee CRUD, auth events) must call `audit()` from `@/lib/audit` after the mutation succeeds (action naming: `"<entity>.<verb>"`). `audit_logs` is append-only; viewer is Admin-only (`/audit`).
- **Verbose logging (2026-07-15):** structured console logging via `createLogger("<scope>")` from `@/lib/log` (level via `LOG_LEVEL`, default debug in dev / info in prod). Three chokepoints are already instrumented — middleware logs every request (with an `x-request-id` header), `ok()`/`fail()` in `@/lib/api/response` log every API response (failures at WARN, 5xx at ERROR), and `audit()` logs every audited mutation — so new routes get logging for free; add ad-hoc `logger.*` lines only for domain events those three can't see.
- **Profile photos:** `POST /employees` is **multipart/form-data** (fields + optional `photo` file), not JSON — the photo was required at creation from 2026-07-15 until 2026-08-05, now **optional** (can be added later via `PUT /employees/:id/photo`). Stored as opaque local-storage keys; always expose via `/employees/:id/photo` (use `withPhotoPath` from `@/lib/employees/photo`), never the raw key.
- **Admin manual overrides (2026-07-15):** `request.override`, `payslip unfinalize`/`delete draft`, `announcement delete` are **Admin-only** (deliberately narrower than Admin/HR), require a `reason` where applicable, and must stay audited. Don't widen these to HR. `attendance/manual` (single + bulk) was **widened to Admin/HR on 2026-08-07** — owner request; it's now access-gated the same as `attendance/:id/edit` (`FINANCE_ROLES`), still audited, still requires a `reason`.

## Attendance sessions (2026-08-11)
A day is one `attendance_records` row **plus one or more `attendance_sessions`**. Clocking out closes the current session; it does not end the day, and the employee can clock back in as often as they need. Consequences that are easy to get wrong:
- `clock_in_raw` is the day's **first** punch in (late-arrival is measured from it) and `clock_out_raw` the **last** — never a single stretch of work.
- Worked time is the **sum of closed sessions** (`summariseSessions` in `@/lib/attendance/sessions`), never last-out minus first-in, or breaks get paid as work.
- "Clocked in right now" = an open session today (`isClockedInNow`). That is the gate on completing tasks and self-logging: an employee may clock back in freely, but **cannot log progress while clocked out**.
- `work_location` (`office` | `wfh`) is set per session at clock-in. A WFH day is a normally worked, normally paid day — distinct from the pre-existing `RequestType.wfh` (asking permission ahead of time).

## Biometric / TeamOffice integration — IN SCOPE
The office biometric punch system is part of this project (API docs PDF in the repo root, gitignored; corporate id/username/password in `.env`). Every punch opens or closes an `attendance_sessions` row, so a device day and a manual day are the same object — `source` becomes `device_sync` and `employees.device_uid` maps the employee. Still open: source-of-truth between HRMS and the TeamOffice DB, and the name-match autoselect for mapping new hires.

## Deferred (do NOT build)
Statutory deductions (PF/ESI/TDS), asset management beyond the stub, non-tech incentive automation.
