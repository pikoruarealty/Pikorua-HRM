# Pikorua HRM — Progress Log

> Living status doc. Update after every meaningful change (standing project rule).
> Source of truth for scope = [docs/](docs/) (PRD, SCHEMA, IMPLEMENTATION_PLAN, API_SPEC).

**Last updated:** 2026-07-13 (Track B Milestone 1 complete: 1.1, 1.2, 1.3, 1.3 hierarchy follow-up; Milestone 2 complete: 2.1 decision, 2.2 metric mode, 2.3 daily planning/EOD + point ledger, 2.4 reimbursements + cross-track helper live)

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
| M2: Metric task mode (Sales/BD) + monthly reset | ✅ (2.1 decision ✅, 2.2 metric CRUD + history ✅) |
| M2: Daily task selection + EOD point ledger | ✅ |
| M2: Reimbursement requests + implement `getApprovedReimbursementTotal` | ✅ |
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

### 2.2 detail (2026-07-13)
Extended `POST /sub-units/:id/work-items` and `PATCH /work-items/:id` to support `mode = metric` (previously atomic-only, metric rejected with `NOT_IMPLEMENTED`). Create requires `targetValue`/`periodMonth`/`periodYear` together; a duplicate (employee, sub-unit, period) triggers `409 CONFLICT` instead of silently creating a second row for the same month, since the 2.1 decision means each period is its own row. PATCH: the owning Lead/Admin/HR can edit `targetValue` any time without touching `currentValue`; the assigned Employee can only update `currentValue`; `status` is derived automatically (`completed` once `currentValue >= targetValue`, else `wip`) rather than settable directly in metric mode — mirrors PRD §5.6's "no fixed done state" rule. Field-mode validation added so `taskPoints` can't be set on a metric item or `targetValue`/`currentValue` on an atomic one.

**Extra — growth-over-time view (stakeholder request, same session):** added `GET /api/v1/employees/:id/work-items/history` (`?year=`/`?limit=` optional), returning an employee's past metric-mode WorkItems newest-period-first with a derived `achievedPct`. RBAC: Admin/HR any employee, Lead their own team (via `team.teamLeadId`), Employee self only, else 403. New file lives under Track A's `employees/` folder (owned by Track B per the 2.3 folder-overlap note) — flagged to Umang once, not a shared-file-list item.

`bun run build` clean. Live-verified against the seeded DB with curl: Sales Lead created a WorkUnit/SubUnit and a July metric WorkItem (target 100 calls); missing `targetValue`/period fields correctly 422'd; a duplicate create for the same (employee, period) correctly 409'd; Sales Employee updated `currentValue` to 45 (status auto-set `wip`) and was blocked (403) from changing `targetValue`; Sales Lead adjusted `targetValue` to 80 mid-period without resetting `currentValue`; pushing `currentValue` to 80 auto-completed the item (`completedAt` set). Created a second (June) metric WorkItem at 72/100 and confirmed `/history` returns both periods ordered newest-first with correct `achievedPct`, visible to the Employee (self), the Sales Lead (own report), and Admin, and correctly 403'd for an unrelated Tech Employee.

### 2.3 detail (2026-07-13)
Built `POST /daily-selections` (Employee only; additive/`skipDuplicates` upsert of `{ workItemIds }` into today's server-computed UTC date, rejecting any id not assigned to the caller), `GET /daily-selections/today` (Employee self, Lead own team via `Team.teamLeadId` — Admin/HR excluded per API_SPEC's strict role list, same convention as `work-items/mine`), `POST /work-items/:id/complete` (assigned Employee only, atomic-mode only — metric items are rejected since they auto-complete via PATCH's current≥target check — credits `taskPoints` to `employee_point_ledger` in the same `$transaction` as the status/`completedAt` update; already-completed → `409`), and `GET /employees/:id/points` (Admin/HR any, Lead own team, Employee self; returns the ledger plus a summed `balance`) — the latter two new files live under Track A's `employees/` folder (owned by Track B per the folder-overlap note; flagged, not shared-file-list). Also **fixed a real gap**: `PATCH /work-items/:id` from 1.2 already let an Employee set `status = completed` directly, which would have skipped ledger crediting now that it exists — added the same transactional credit to PATCH's atomic-completion branch, guarded by `wasCompleted` (checked pre-update) on both routes so completion credits exactly once no matter which endpoint is used. `bun run build` clean. Live-verified against the seeded DB with curl: Tech Lead created a fresh atomic WorkItem (15 pts) for Tech Employee; Lead's own `/daily-selections` POST correctly 403'd (Employee-only); Employee's selection of an unassigned item 422'd, selecting their own item succeeded and was idempotent on re-POST; `GET /daily-selections/today` showed the selection to the Employee (self) and Lead (own team), returned empty for an unrelated Sales Employee, and 403'd for Admin; Lead's `/complete` attempt 403'd (assignee-only), Employee's `/complete` credited 15 points and returned `409` on retry; `GET /employees/:id/points` showed `balance: 15` for self/Lead/Admin and 403'd for an unrelated Sales Employee; a second WorkItem (8 pts) completed via direct `PATCH status=completed` correctly credited (balance → 23), and re-PATCHing it to `completed` again left the balance unchanged at 23 (no double credit).

### 2.4 detail (2026-07-13)
Extended `POST /requests` to accept `type = reimbursement` (`amount` required, `attachmentUrl` optional) alongside the existing leave types — `wfh`/`other` remain `NOT_IMPLEMENTED`/501 until Milestone 3. No RBAC changes needed: `CAN_SUBMIT_ROLES`/golden-rule approve-reject logic from 1.3 is already type-agnostic. **Flagged before editing** — implemented the cross-track shared helper `getApprovedReimbursementTotal(employeeId, month, year)` in `apps/web/lib/requests/reimbursements.ts` (Phase 0 contract, imported by Track A's payroll): sums `amount` for `type = reimbursement`, `status = approved`, scoped by `approvedAt` falling in the given month/year (not `createdAt` — a reimbursement is keyed to the payroll period it's *approved* in, per PRD §5.2/§5.13, since request submission and approval can span different months). Signature kept exactly as the Phase 0 stub (`(employeeId, month, year) => Promise<number>`) — Track A's payroll call site needs no changes; it just stops throwing `NotImplementedError`. `bun run build` clean. Live-verified with curl + a direct script call: reimbursement missing `amount` 422'd; Team Lead's approve attempt on a reimbursement still 403'd (golden rule holds); HR approved a ₹1500 request → helper returned 1500 for the current month, 0 for the prior month; a second ₹700 approval → total 2200; a third ₹9999 request that was *rejected* was correctly excluded from the sum.

**Milestone 2 is now fully complete** (2.1 decision, 2.2 metric mode + history, 2.3 daily planning/EOD + point ledger, 2.4 reimbursements). Next: Milestone 3 (3.1 recognition leaderboard + Employee of the Month, 3.2 notifications, 3.3 announcements, 3.4 documents, 3.5 events).

---

## Open decisions (blocking specific features — confirm with stakeholder)
See PRD §7. Tracked in memory (`open-questions`):
1. ⚠️ `bde_lead` role — needed or not? (currently excluded from role enum)
2. ⚠️ Meeting reminder channel — in-app only vs. also email/SMS (assuming in-app)
3. ⚠️ Employee of the Month ties — single winner vs. multiple
4. ✅ Monthly metric-target reset — **resolved 2026-07-13: new row per month.** Each metric-mode WorkItem is scoped to one `period_month`/`period_year`; the next month gets a fresh `work_items` row rather than resetting `current_value` in place. Rationale: preserves per-month history for `recognition_snapshots` without a fragile "snapshot-before-reset" job ordering, and avoids any scheduled job silently destroying `current_value`. A monthly rollover (new row, `target_value` carried forward or re-set by the Lead) will be built as part of 2.2.
