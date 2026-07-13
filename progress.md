# Pikorua HRM — Progress Log

> Living status doc. Update after every meaningful change (standing project rule).
> Source of truth for scope = [docs/](docs/) (PRD, SCHEMA, IMPLEMENTATION_PLAN, API_SPEC).

**Last updated:** 2026-07-13 (Track B M1.2 complete)

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
| First Prisma migration + `bun run build` verified | ✅ | Confirmed 2026-07-13: local Postgres 18 running on **port 5433** (not 5432 — WSL's `wslrelay.exe` squats on 127.0.0.1:5432/::1:5432, shadowing native Postgres; moved native instance to 5433 to avoid the conflict, see `postgresql.conf`). `.env` created from `.env.example` with real `DATABASE_URL`/`AUTH_SECRET`. `prisma migrate dev --name init` and `bun run db:seed` both succeeded. `bun run build` compiles clean. |
| Shared-file warning mechanism | ✅ | Canonical list now in `CLAUDE.md` (Shared foundation section). Two enforcement layers: (1) AI rule — Claude stops and flags before editing a listed file; (2) `.githooks/pre-commit` — warns (never blocks) at commit time if staged files match the list. Hook is opt-in: run `git config core.hooksPath .githooks` once per clone (not run automatically — see README "Contributing"). |

### Package manager / runtime: **Bun** (1.3.14)
Bun is the package manager and runtime for this project. Bun runs the TypeScript seed directly (`bun prisma/seed.ts`), so `tsx` was dropped. Root scripts use `bun run --filter=@pikorua-hrm/web <script>` for the workspace app.

### To finish Phase 0 (next actions)
1. ~~`bun install`~~ ✅ done.
2. Set up a Postgres DB, copy `.env.example` → `.env`, set `DATABASE_URL` + `AUTH_SECRET`.
3. `bun run prisma:migrate` (creates the initial migration from the full schema).
4. `bun run db:seed`.
5. Confirm login works end-to-end (`POST /api/v1/auth/login`).
6. `bun run build` to confirm the scaffold compiles.
7. Then branch: `track-a/*` and `track-b/*`.

---

## Track A — People, Time & Money (owner: Umang)
Employees · Departments/Teams/Hierarchy config · Attendance (manual) · Payroll/Payslips

| Milestone | Status |
|---|---|
| Employee CRUD + department/team management | ⬜ |
| `department_labels` config UI | ⬜ |
| Manual Clock In/Out + HR/Admin approval & edit screen | ⬜ |
| Payroll config + payslip generation (manual fields + auto deductions + reimbursement pull-in + EoM ref) | ⬜ |

## Track B — Work, Requests & Culture (owner: Bhavarth)
Work units/tasks · Daily planning/EOD · Requests · Recognition · Notifications · Announcements · Docs · Events · Assets stub

**Full detailed tasklist with context, files, RBAC, and definitions of done: [TRACK_B_TASKLIST.md](TRACK_B_TASKLIST.md).** Table below mirrors it at milestone granularity — update both when a milestone's status changes.

| Milestone | Status |
|---|---|
| M1: WorkUnit/SubUnit/WorkItem CRUD (atomic only) | ✅ (1.1 WorkUnit CRUD ✅, 1.2 SubUnit/WorkItem CRUD ✅) |
| M1: Requests — leave type only, HR/Admin-only approval | ⬜ |
| M2: Metric task mode (Sales/BD) + monthly reset | ⬜ |
| M2: Daily task selection + EOD point ledger | ⬜ |
| M2: Reimbursement requests + implement `getApprovedReimbursementTotal` | ⬜ |
| M3: Recognition leaderboard + Employee of the Month + implement `getEmployeeOfMonthStatus` | ⬜ |
| M3: Notifications infra | ⬜ |
| M3: Announcements (team/all/specific-team scoping) | ⬜ |
| M3: Employee documents upload | ⬜ |
| M3: Events — birthday banner + Meetings + reminders | ⬜ |
| M4: Cross-track integration testing (joint w/ Track A) | ⬜ |
| Assets stub | ⬜ |

### 1.2 detail (2026-07-13)
Built `POST /work-units/:id/sub-units`, `POST /sub-units/:id/work-items` (atomic only — `mode = metric` rejected with `NOT_IMPLEMENTED`/501), `PATCH /work-items/:id`, `GET /work-items/mine`. Also extended `GET /work-units/:id` to nest `subUnits` + `workItems` per API_SPEC §4 (Employee's status-only view filters `workItems` down to their own assignments). `bun run build` clean. Verified live against the seeded DB with curl: Tech Lead creates sub-unit/work-item; Sales Lead gets 404 (not 403) on another department's WorkUnit; Tech Employee gets 403 creating sub-units; atomic WorkItem requires `taskPoints`; assigned Employee can cycle `pending → wip → completed` (server sets `completedAt`) but 403s on editing `taskPoints`; owning Lead can edit all fields including `taskPoints`; `GET /work-items/mine` returns the assignee's own tasks and 403s for non-Employee roles (tech_lead) per spec's strict role list.

---

## Open decisions (blocking specific features — confirm with stakeholder)
See PRD §7. Tracked in memory (`open-questions`):
1. ⚠️ `bde_lead` role — needed or not? (currently excluded from role enum)
2. ⚠️ Meeting reminder channel — in-app only vs. also email/SMS (assuming in-app)
3. ⚠️ Employee of the Month ties — single winner vs. multiple
4. ⚠️ Monthly metric-target reset — new row per month vs. reset-in-place (Track B to decide)
