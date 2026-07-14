# Pikorua HRM — Progress Log

> Living status doc. Update after every meaningful change (standing project rule).
> Source of truth for scope = [docs/](docs/) (PRD, SCHEMA, IMPLEMENTATION_PLAN, API_SPEC).

**Last updated:** 2026-07-14 (Track A Milestone 3 — Payroll — code complete, blocked on Track B for full end-to-end)

---

## Legend
- ✅ done · 🚧 in progress · ⬜ not started · ⚠️ blocked / needs decision

---

## Phase 0 — Shared Foundation (`main`)

Built together before the two tracks branch off. Both tracks depend on these files.

| Item | Status | Notes |
|---|---|---|
| Repo scaffold (npm workspaces, `apps/web`, root `prisma/`) | ✅ | Matches IMPLEMENTATION_PLAN §2 tree |
| Next.js + TypeScript + Tailwind + shadcn tokens | ✅ | `apps/web` (Next 14 App Router) |
| `.env.example` (all shared env vars) | ✅ | DB, AUTH_SECRET, S3, CRON_SECRET |
| `prisma/schema.prisma` — **full** schema, all tables | ✅ | Every table from SCHEMA.md; deferred `device_punch_raw` intentionally omitted |
| `lib/db` — Prisma client singleton | ✅ | `@/lib/db/prisma` |
| `lib/rbac` — roles + `requireRole()` + role groups | ✅ | 7 roles; `bde_lead` deliberately excluded (⚠️ see open questions) |
| `lib/auth` — password hashing + JWT session | ✅ | bcryptjs + jose; `getSession()` |
| `lib/api` — `{ data, error }` envelope | ✅ | `ok()` / `fail()` / `failFor()` |
| Auth routes: login / logout / me | ✅ | `app/api/v1/auth/*` |
| `components/ui` — shadcn primitives | ✅ | button, card, input, label, badge, table |
| Cross-track helper contracts (signatures) | ✅ | `getApprovedReimbursementTotal`, `getEmployeeOfMonthStatus` — stubbed, throw NotImplemented (Track B implements) |
| Seed script (payroll config, 3 depts + labels, teams, 7 role users) | ✅ | `prisma/seed.ts`, default pw `Password123!` |
| Dependency-graph tooling ("graphify") | ✅ | dependency-cruiser: `.dependency-cruiser.cjs` + `depgraph:*` npm scripts; enforces no-circular + track boundaries. SVG output needs GraphViz `dot`. |
| `bun install` + dev server running | ✅ | Confirmed by user 2026-07-13: `bun install` succeeded, `bun run dev` starts (a stale `.next/cache/webpack` pack file warning appeared — benign, cache-only, Next rebuilds it). |
| First Prisma migration + `bun run build` verified | ✅ | Confirmed 2026-07-13: local Postgres 16 running, `pikorua_hrm` DB created, `.env` populated (real `AUTH_SECRET` via `openssl rand -base64 48`). `bun run prisma:migrate --name init` applied cleanly (`migrations/20260713100632_init`). `bun run db:seed` succeeded (7 users). `POST /api/v1/auth/login` and `GET /api/v1/auth/me` verified end-to-end against a running `bun run dev` server (200 OK, valid session cookie, correct role/employee payload). `bun run build` compiles clean (0 errors, all 3 auth routes + `/` built). |

### Package manager / runtime: **Bun** (1.3.14)
Bun is the package manager and runtime for this project. Bun runs the TypeScript seed directly (`bun prisma/seed.ts`), so `tsx` was dropped. Root scripts use `bun run --filter=@pikorua-hrm/web <script>` for the workspace app.

### Phase 0 — all verification steps complete ✅
1. ~~`bun install`~~ ✅ done.
2. ~~Set up a Postgres DB, copy `.env.example` → `.env`, set `DATABASE_URL` + `AUTH_SECRET`~~ ✅ done (local Postgres 16, `pikorua_hrm` db).
3. ~~`bun run prisma:migrate`~~ ✅ done — `migrations/20260713100632_init`.
4. ~~`bun run db:seed`~~ ✅ done.
5. ~~Confirm login works end-to-end~~ ✅ done — `/auth/login` + `/auth/me` both verified.
6. ~~`bun run build`~~ ✅ done — compiles clean.
7. Next: branch `track-a/*` and `track-b/*`, then start Track A Milestone 1 (see [docs/TRACK_A_TASKS.md](docs/TRACK_A_TASKS.md)).

---

## Track A — People, Time & Money (owner: Umang)
Employees · Departments/Teams/Hierarchy config · Attendance (manual) · Payroll/Payslips

| Milestone | Status |
|---|---|
| Employee CRUD + department/team management | ✅ |
| `department_labels` config UI | ✅ |
| Manual Clock In/Out + HR/Admin approval & edit screen | ✅ |
| Payroll config + payslip generation (manual fields + auto deductions + reimbursement pull-in + EoM ref) | ⚠️ code complete, blocked on Track B stubs for a full live generation |

### Milestone 1 — Org Structure Foundations ✅ (2026-07-13)
Verified live against the seeded DB (login → API → role-scoped response for every endpoint below), not just build-checked.

- **Departments**: `GET/POST /api/v1/departments`, `GET/PUT /api/v1/departments/:type_key/labels`. Admin-only config screen at `app/(dashboard)/departments`, `components/departments/departments-screen.tsx`.
- **Teams**: `GET/POST /api/v1/teams`, `PATCH /api/v1/teams/:id`. `team_lead_id` validated against `isLeadRole()` (read-only use of shared `lib/rbac`). Admin/HR manage; Lead/Employee get a department-scoped read view. `app/(dashboard)/teams`, `components/teams/teams-screen.tsx`.
- **Employees**: full CRUD at `app/api/v1/employees[, /:id]` — role-scoped (Admin/HR all, Lead own team, Employee self); `base_salary` excluded from the response for non-finance roles (golden RBAC rule); `DELETE` is soft-delete only (`status → inactive`). Dashboard at `app/(dashboard)/employees[, /new, /:id]`, `components/employees/`.
- **Open decision resolved**: `POST /employees` provisions the linked `User` login in the same call — server generates a temporary password (returned once in the response, never persisted in plaintext) unless the caller supplies one.
- **New shared-adjacent additions** (not on the CLAUDE.md shared-file list, but touched by both tracks going forward — flag before restructuring): `app/(auth)/login` (login page — a Phase 0 gap; needed to browser-test any dashboard screen), `app/(dashboard)/layout.tsx` + `components/dashboard-nav.tsx` (auth-gated shell + top nav; Track B adds its own links here as its screens land).

### Milestone 2 — Attendance ✅ (2026-07-14)
Verified live against the seeded DB, not just build-checked: clocked in/out as a real seeded employee, confirmed duplicate clock-in/out both correctly return `409`, approved as Admin, and pulled the resulting summary — got `late_count: 1` (team's `expectedStartTime` was `09:00`, clock-in was `12:13` local) and `half_day_count: 1` (0 actual worked hours) for one employee, and confirmed a team with no `expectedStartTime` configured returns `late_count: 0` with an explicit `late_tracking_unavailable` note rather than a silently-wrong zero. Also verified RBAC: employee gets `403` approving their own record, a Team Lead's `GET /attendance` only returns their own team's records, and an employee gets `403` requesting another employee's summary.

- **Clock in/out**: `POST /api/v1/attendance/{clock-in,clock-out}` — server-timestamped, relies on the existing `@@unique([employeeId, date])` constraint; open to any authenticated user with a linked employee record (not just `EMPLOYEE_ROLES` — Leads/Admin/HR clock in too).
- **Review & approval**: `GET /api/v1/attendance` (role-scoped list), `GET /api/v1/attendance/:employee_id/summary` (approved-only late/half-day/unpaid-leave counts), `PATCH /api/v1/attendance/:id/edit`, `PATCH /api/v1/attendance/:id/approve`. Dashboard at `app/(dashboard)/attendance`, `components/attendance/attendance-screen.tsx`.
- **Open decision resolved**: late threshold is **team-wise**, not global — new `Team.expectedStartTime` field ("HH:MM", nullable, editable from the Teams screen). A schema.prisma edit, flagged in CLAUDE.md's shared-file list.
- **New cross-track contract** (not in the original Phase 0 agreement — flag to Bhavarth): `getApprovedUnpaidLeaveDays()` in `apps/web/lib/requests/leave.ts`, stubbed the same way as the two original cross-track helpers. The summary endpoint catches its `NotImplementedError` specifically and reports `unpaid_leave_count: null` with a note, rather than failing the whole endpoint.
- Full details: [docs/TRACK_A_TASKS.md](docs/TRACK_A_TASKS.md) Milestone 2.

### Milestone 3 — Payroll ⚠️ code complete 2026-07-14, blocked on Track B for full live verification

- **Payroll config**: `GET/PUT /api/v1/payroll/config`. `GET` is Admin/HR; `PUT` is **Admin only** (tighter than the other FINANCE_ROLES-gated endpoints — matches API_SPEC.md §6 exactly) and always **inserts** a new versioned row keyed by `effective_from`, never overwrites — verified live: set a new rate row effective `2026-08-01`, confirmed a period lookup for `2026-07` still resolves to the original `2026-01-01` row and `2026-08` resolves to the new one (via `getEffectivePayrollConfig` in `lib/payroll/config.ts`). Dashboard at `app/(dashboard)/payroll/config`, `components/payroll/payroll-config-screen.tsx` (edit form only rendered for Admin).
- **Employee-of-Month reference lookup**: `GET /api/v1/payslips/:employee_id/employee-of-month-status` — Admin/HR. Folder is `[id]` for the same Next.js one-dynamic-segment-per-level reason as `attendance/[id]` (this level also serves the payslip *id* for `GET /payslips/:id` and `PATCH /payslips/:id/finalize`).
- **Payslip generation**: `POST /api/v1/payslips/generate` — Admin/HR. Pulls late/half-day/unpaid-leave counts from a new shared `lib/attendance/summary.ts` (extracted from the Milestone 2 summary endpoint so both routes compute identically off **approved-only** attendance — the existing summary route was refactored to call it too, confirmed unchanged behavior live after the refactor). Computes `standard_deduction_total` from those counts × the period's effective payroll config. Calls Track B's `getApprovedReimbursementTotal` and `getEmployeeOfMonthStatus` stubs.
  - **Cross-track NotImplementedError handling — a deliberate asymmetry, not a bug**: `reimbursement_total` directly changes `net_pay`, so a `NotImplementedError` there **blocks generation entirely** (`422`, verified live) rather than silently computing a wrong number — this is the standing "never bluff" rule. `employee_of_month_ref` is explicitly reference-only per API_SPEC.md and never affects `net_pay`, so its `NotImplementedError` degrades to `false` + a note instead of blocking, matching how `unpaid_leave_count` already degrades to `0` + a note in the Milestone 2 summary endpoint. **As of this writing, full end-to-end payslip generation is blocked** until Track B implements `getApprovedReimbursementTotal` — confirmed live (`422 NOT_IMPLEMENTED`), not a Track A bug.
  - Enforces one payslip per employee per period (`@@unique([employeeId, periodYear, periodMonth])` on the existing schema) — a second `generate` call for the same period returns `409`.
- **Payslip list/detail/finalize**: `GET /api/v1/payslips` (Admin/HR all + filterable; Employee self + **finalized only**, drafts never visible — verified live: HR/Employee both get scoped empty lists as expected), `GET /api/v1/payslips/:id` (same scoping), `PATCH /api/v1/payslips/:id/finalize` (Admin/HR, `draft → finalized`, `409` if already finalized). Dashboard: `app/(dashboard)/payslips` (list + generation form, generation form only rendered for FINANCE_ROLES) and `app/(dashboard)/payslips/[id]` (breakdown view + Finalize button for FINANCE_ROLES). Both pages confirmed rendering (`200`, no server errors) live for Admin.
- **RBAC verified live**: Employee gets `403` on `GET /payroll/config` and `POST /payslips/generate`; Admin-only gate confirmed on `PUT /payroll/config` (`403` for HR).
- No `prisma/schema.prisma` changes were needed — `PayrollConfig`/`Payslip` were already fully modeled from Phase 0; **no new fields were added** (note: the original Milestone 3 handoff mentioned `finalized_at`/`finalized_by` columns and PF/TDS-percent config fields — neither exists in the actual schema, which uses flat late/half-day/unpaid-leave deduction amounts instead. Trusted `schema.prisma`/`docs/SCHEMA.md`/`docs/API_SPEC.md` over the stale handoff text).
- **Known gap, not yet done**: full live verification of a successful (non-blocked) payslip generation + finalize, since that requires Track B's reimbursement helper. Re-verify once Track B lands it (Milestone 4 item).

## Track B — Work, Requests & Culture (owner: Bhavarth)
Work units/tasks · Daily planning/EOD · Requests · Recognition · Notifications · Announcements · Docs · Events · Assets stub

| Milestone | Status |
|---|---|
| WorkUnit/SubUnit/WorkItem CRUD (atomic + metric) | ⬜ |
| Daily task selection + EOD point ledger | ⬜ |
| Generic Requests + HR/Admin-only approval | ⬜ |
| Recognition leaderboard + Employee of the Month | ⬜ |
| Notifications infra | ⬜ |
| Announcements (team/all/specific-team scoping) | ⬜ |
| Employee documents upload | ⬜ |
| Events: birthday banner + Meetings + reminders | ⬜ |
| Implement the two cross-track helper stubs | ⬜ |
| Assets stub | ⬜ |

---

## Open decisions (blocking specific features — confirm with stakeholder)
See PRD §7. Tracked in memory (`open-questions`):
1. ⚠️ `bde_lead` role — needed or not? (currently excluded from role enum)
2. ⚠️ Meeting reminder channel — in-app only vs. also email/SMS (assuming in-app)
3. ⚠️ Employee of the Month ties — single winner vs. multiple
4. ⚠️ Monthly metric-target reset — new row per month vs. reset-in-place (Track B to decide)
