# Pikorua HRM — Progress Log

> Living status doc. Update after every meaningful change (standing project rule).
> Source of truth for scope = [docs/](docs/) (PRD, SCHEMA, IMPLEMENTATION_PLAN, API_SPEC).

**Last updated:** 2026-07-13 (Track B Milestone 1 complete: 1.1, 1.2, 1.3; 1.3 hierarchy-submission follow-up)

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
| M1: Requests — leave type only, HR/Admin-only approval | ✅ |
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

### 1.3 detail (2026-07-13)
Built `POST /requests`, `GET /requests`, `GET /requests/:id`, `PATCH /requests/:id/approve`, `PATCH /requests/:id/reject` — leave types only this milestone (`leave_paid`/`leave_unpaid`); other types (`reimbursement`/`wfh`/`other`) rejected with `NOT_IMPLEMENTED`/501, mirroring the 1.2 metric-mode pattern. Golden rule enforced: approve/reject check `FINANCE_ROLES` before anything else, so a Team Lead gets 403 on their own team's request every time, and re-approving/rejecting a non-pending request returns 409. GET scoping matches WorkUnit's pattern: Admin/HR see all (with `type`/`status`/`employee_id` filters), Lead sees own team only (resolved via `Team.teamLeadId`, filters ignore attempts to escape team scope), Employee sees self only, and cross-scope `GET /requests/:id` 404s instead of 403 to avoid leaking existence. `bun run build` clean. Verified live against the seeded DB with curl across Tech Lead, Tech Employee, Sales Lead, Sales Employee, HR, and Admin — including catching and fixing a real bug during verification (reimbursement type was failing zod validation on missing dates before ever reaching the leave-type-only rejection check; fixed by making `dateFrom`/`dateTo` optional at the schema level and validating their presence only after confirming the type is a leave type).

**2026-07-13 update — hierarchy submission resolved.** Stakeholder direction: leave requests work in hierarchy — Team Leads can file their own leave (approved by HR/Admin) and HR can file their own leave (approved by Admin only). `POST /requests` now allows Employees, Team Leads, and HR (`CAN_SUBMIT_ROLES` in `requests/route.ts`); Admin is intentionally excluded (no one above Admin to approve it). Approval stays Admin/HR only per the golden rule — unchanged — but `approve`/`reject` now block self-approval by comparing the requester's linked `User.id` to the approving session's `userId`, so an HR request can't be approved by that same HR user and must go up to Admin. Lead's team-scoped `GET /requests` was extended to also include the Lead's own filed requests (previously only team *members*, which excluded the Lead). `bun run build` clean; live-verified with curl: Tech Lead and HR each filed their own leave, HR self-approve attempt got 403, Admin approved HR's request, HR approved the Lead's request, and a Tech Employee still got 403 attempting to reject (golden rule intact).

---

## Open decisions (blocking specific features — confirm with stakeholder)
See PRD §7. Tracked in memory (`open-questions`):
1. ⚠️ `bde_lead` role — needed or not? (currently excluded from role enum)
2. ⚠️ Meeting reminder channel — in-app only vs. also email/SMS (assuming in-app)
3. ⚠️ Employee of the Month ties — single winner vs. multiple
4. ⚠️ Monthly metric-target reset — new row per month vs. reset-in-place (Track B to decide)
