# Track B Tasklist — Work, Requests & Culture

> Owner: **Bhavarth**. Companion to [progress.md](progress.md) (tick items off in both places) and [CLAUDE.md](CLAUDE.md) (standing rules + shared-file list). Source of truth for scope: [docs/PRD.md](docs/PRD.md), [docs/SCHEMA.md](docs/SCHEMA.md), [docs/API_SPEC.md](docs/API_SPEC.md), [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

## How to use this file

- Work top to bottom — milestones build on each other (M2 assumes M1's atomic WorkItem CRUD exists, etc.).
- Every task lists: **What**, **Why** (spec reference), **Files**, **RBAC**, **Definition of done**.
- **⚠️ SHARED FILE** callouts mean: stop, re-read [CLAUDE.md's shared-file list](CLAUDE.md), tell/flag Umang before merging (the git hook at `.githooks/pre-commit` will also warn at commit time if you've enabled it — see README).
- After finishing a task, tick the matching row in `progress.md`'s Track B milestone table and update its Status.
- Standing rules apply to every task: **cascading, complete updates** (schema → API → UI, never partial) and **never bluff** (don't mark something done unless it's actually verified — build it, run it, don't just write the code).
- All Track B tables already exist in `prisma/schema.prisma` from Phase 0 (see SCHEMA.md §2, §5, §6) — you're building API + UI on top of an existing schema, not adding new tables, *except* where a task below explicitly says otherwise.

---

## Milestone 1 — WorkUnit/Task CRUD (Atomic/Tech only) + basic Requests (leave only) ✅ done (2026-07-13)

### 1.1 WorkUnit CRUD ✅ done (2026-07-13)

**What:** Create/list/view/update WorkUnits (Projects/Campaigns). Tech-department scope only this milestone (Sales/BD metric mode comes in M2).
**Why:** PRD §5.6, §4.2. API_SPEC §4.
**Files:** `apps/web/app/api/v1/work-units/route.ts` (GET, POST), `apps/web/app/api/v1/work-units/[id]/route.ts` (GET, PATCH), `apps/web/components/work-units/**`, `apps/web/app/(dashboard)/work-units/**`.
**RBAC:** POST = Lead or Admin/HR (`team_lead_id` defaults to creator if Lead). GET = Any, scoped: Admin/HR see all, Lead sees own department, Employee sees assigned-or-own-department status-only. PATCH = owning Lead or Admin/HR.
**Definition of done:** A Tech Lead can create a WorkUnit via API and see it listed; an Employee in a different department cannot see it.

### 1.2 SubUnit + WorkItem CRUD (atomic mode only) ✅ done (2026-07-13)

**What:** Nest SubUnits (Features) under a WorkUnit, and WorkItems (Tasks) under a SubUnit. `mode = atomic` only this milestone — `task_points` required, `status` cycles `pending → wip → completed`. Reject `mode = metric` for now (M2 adds it).
**Why:** PRD §4.2, §5.6. API_SPEC §4. SCHEMA.md `work_items`.
**Files:** `apps/web/app/api/v1/work-units/[id]/sub-units/route.ts` (POST), `apps/web/app/api/v1/sub-units/[id]/work-items/route.ts` (POST), `apps/web/app/api/v1/work-items/[id]/route.ts` (PATCH), `apps/web/app/api/v1/work-items/mine/route.ts` (GET).
**RBAC:** Create sub-unit/work-item = owning Lead or Admin/HR (Lead sets `task_points`). PATCH work-item = assigned Employee (status only) or Lead (all fields, can reassign/edit points).
**Definition of done:** A Lead creates a task with `task_points`, assigns it to an Employee; the Employee can flip status pending → wip → completed via PATCH but cannot edit `task_points`.

### 1.3 Requests module — leave type only ✅ done (2026-07-13)

**What:** Generic Request entity; this milestone only exercises `leave_paid` / `leave_unpaid`. Reimbursement/WFH/other come in M2+.
**Why:** PRD §5.9. API_SPEC §7. SCHEMA.md `requests`.
**Files:** `apps/web/app/api/v1/requests/route.ts` (POST, GET), `apps/web/app/api/v1/requests/[id]/route.ts` (GET), `apps/web/app/api/v1/requests/[id]/approve/route.ts` (PATCH), `apps/web/app/api/v1/requests/[id]/reject/route.ts` (PATCH), `apps/web/components/requests/**`, `apps/web/app/(dashboard)/requests/**`.
**RBAC:** POST = Employee (creates own). GET = Admin/HR all, Lead own team (view only), Employee self. Approve/reject = **Admin/HR only, always** — this is the PRD "golden rule," enforce in code, not just UI; Team Leads must get a 403 even for their own team's requests.
**Definition of done:** An Employee submits a leave request; their Team Lead can see it but a direct API call to approve as that Lead returns 403; Admin/HR can approve it.

---

## Milestone 2 — Metric tasks (Sales/BD) + Daily Planning/EOD + Reimbursements

### 2.1 Resolve the monthly-reset approach (do this first, before coding) ✅ done (2026-07-13)

**What:** SCHEMA.md's `work_items` note flags an open implementation choice: (a) a new metric `work_item` row each month, or (b) one recurring row with `current_value` reset in place while `period_month`/`period_year` advance. Pick one and record the decision.
**Why:** PRD §7 open question #4; affects how `period_month`/`period_year` filtering works in every downstream query (recognition snapshots, EoM).
**Files:** none yet — this is a decision, not code.
**Definition of done:** Decision written to `progress.md`'s open-decisions section and to the `open-questions` memory (mark resolved, note the choice + reasoning) before writing any metric-mode code.

### 2.2 Metric mode for WorkItems (Sales/BD) ✅ done (2026-07-13)

**What:** Extend WorkItem create/update to support `mode = metric`: `target_value` (editable any time by the Lead), `current_value` (running count, updated by the assigned Employee), `period_month`/`period_year`. No fixed "done" state required — default completion = current ≥ target, per PRD §5.6.
**Why:** PRD §4.2, §5.7. API_SPEC §4, §5.
**Files:** extend `apps/web/app/api/v1/sub-units/[id]/work-items/route.ts` and `apps/web/app/api/v1/work-items/[id]/route.ts` from M1 (branch on `mode`).
**RBAC:** same as 1.2 — Lead sets/edits `target_value` any time; assigned Employee updates `current_value` only.
**Definition of done:** A Sales Lead sets a target of 100 calls; the Sales Employee updates `current_value` via PATCH; a Lead can adjust `target_value` mid-month without resetting `current_value`.

**Extra (stakeholder request, 2026-07-13):** growth-over-time view — `GET /api/v1/employees/:id/work-items/history` (new file, physically under Track A's `app/api/v1/employees/` folder per the folder-overlap note below; flagged, not a shared-file-list item). Returns an employee's past metric-mode WorkItems ordered by `period_year`/`period_month` desc, each with `targetValue`, `currentValue`, and a derived `achievedPct`. Optional `?year=`/`?limit=` filters. RBAC: Admin/HR any employee, Lead their own team's employees (via `team.teamLeadId`), Employee self only — else 403. Placement decision: built now in 2.2 (metric-only, per-employee), to be revisited/generalized once 3.1's `recognition_snapshots` exists for both Tech and Sales/BD.

### 2.3 Daily Planning / EOD flow + point ledger ✅ done (2026-07-13)

**What:** At clock-in, Employee selects today's WorkItems (`daily_task_selections`). Through the day they update progress. On atomic-task completion, credit `task_points` to `employee_point_ledger` (server-side, never client-computed).
**Why:** PRD §5.4. API_SPEC §5. SCHEMA.md `daily_task_selections`, `employee_point_ledger`.
**Files:** `apps/web/app/api/v1/daily-selections/route.ts` (POST), `apps/web/app/api/v1/daily-selections/today/route.ts` (GET), `apps/web/app/api/v1/work-items/[id]/complete/route.ts` (POST — marks completed, credits ledger in the same transaction), `apps/web/app/api/v1/employees/[id]/points/route.ts` (GET).
**RBAC:** POST daily-selections/complete = the assigned Employee only. GET today = Employee self, Lead own team. GET points = Admin/HR, Lead own team, Employee self.
> ⚠️ **Folder overlap, not a shared file:** `employees/[id]/points/route.ts` is a *new file* inside `app/api/v1/employees/`, which is Track A's named folder per Implementation Plan §2. Low conflict risk (no existing file edited), but give Umang a heads-up once, since it's the first Track B file living under an "A" folder.
**Definition of done:** Employee selects a task at (simulated) clock-in, marks it completed via `/complete`, and `GET /employees/:id/points` shows the credited points — verify the ledger entry exists, not just the response shape.

**Implementation note:** `PATCH /work-items/:id` (from 1.2) already let the assigned Employee set `status = completed` directly, which would have bypassed `/complete`'s ledger crediting entirely — a real gap once the ledger existed. Fixed by adding the same transactional credit-on-completion logic to PATCH's atomic branch; both routes guard on `wasCompleted` (checked before the update) so completing via either path credits exactly once, and re-completing an already-completed item via the other path is a no-op (PATCH) or `409 CONFLICT` (`/complete`). Live-verified: completed one item via `/complete` (15 pts), a second via PATCH directly (8 pts, balance → 23), then re-PATCHed the second item to `completed` again and confirmed the balance stayed at 23 (no double credit).

### 2.4 Reimbursement request type + implement the cross-track helper ✅ done (2026-07-13)

**What:** Extend the Requests module (M1) to handle `type = reimbursement` (`amount`, `attachment_url`). Then implement `getApprovedReimbursementTotal(employeeId, month, year)` for real in `apps/web/lib/requests/reimbursements.ts` — sum `amount` for `type = reimbursement`, `status = approved`, filtered to the given period.
**Why:** PRD §5.2, §5.13. Implementation Plan §5 (cross-track contract). API_SPEC §7.
**Files:** extend `apps/web/app/api/v1/requests/**` from 1.3; ⚠️ **SHARED FILE** — `apps/web/lib/requests/reimbursements.ts` (implementing the stub is expected/owned by Track B per the Phase 0 contract — flag Umang once it's live, since Track A's payroll code stops throwing `NotImplementedError` and starts returning real numbers; don't change the function signature).
**RBAC:** same approve/reject rule as 1.3 (Admin/HR only).
**Definition of done:** An approved reimbursement request's amount is correctly summed by `getApprovedReimbursementTotal` for its period — write a quick manual check (or unit test) calling the function directly, not just eyeballing the request list UI.

**Implementation note:** Reimbursement requests have no `period_month`/`period_year` field of their own (unlike leave's `dateFrom`/`dateTo` range), so `getApprovedReimbursementTotal` scopes the period off `approvedAt`, not `createdAt` — per PRD §5.2/§5.13 ("once approved, added into the payslip"), a reimbursement belongs to whichever month it's *approved* in, not submitted in. Flagged to Umang before editing (shared file); signature unchanged (`(employeeId, month, year) => Promise<number>`), so Track A's payroll call site needs no changes — it just stops throwing `NotImplementedError` and starts getting real totals. `bun run build` clean. Live-verified: reimbursement missing `amount` correctly 422'd; a Team Lead's approval attempt still 403'd (golden rule holds for reimbursement same as leave); HR approved a ₹1500 request and `getApprovedReimbursementTotal` returned 1500 for the current month and 0 for the prior month; a second ₹700 approval brought the total to 2200, while a third (₹9999) request that was *rejected* was correctly excluded from the sum.

### 2.4b Cross-track stub: `getApprovedUnpaidLeaveDays` ⏳ stub added, real impl pending (2026-07-14)

**What:** Umang (Track A) hit a gap while building the payroll summary endpoint — unpaid leave days aren't in `attendance_records`, they're `requests.type = leave_unpaid, status = approved`, which Track B owns. Per his selected option, added a 3rd cross-track stub now (not a full implementation): `getApprovedUnpaidLeaveDays(employeeId, month, year): Promise<number>` in `apps/web/lib/requests/reimbursements.ts`, throwing `NotImplementedError("getApprovedUnpaidLeaveDays", "Track B")` — same file/pattern as `getApprovedReimbursementTotal` originally started as. Track A's summary endpoint calls it and should surface the thrown error clearly in dev, not swallow it as zero.
**Why:** Cross-track dependency raised 2026-07-14; Implementation Plan §5 pattern extended to a 3rd helper.
**Files:** ⚠️ **SHARED FILE** — `apps/web/lib/requests/reimbursements.ts` (flagged before editing, same as 2.4).
**RBAC:** N/A (internal helper, no route).
**Definition of done (real impl, not yet done):** Real day-counting logic — needs a decision on how to count a `leave_unpaid` range (`dateFrom`/`dateTo`) that spans two payroll periods (split across both, or attribute wholly to one — likely `dateFrom`'s period by analogy with attendance-based counting, but unconfirmed). Until then this is a stub only; `bun run build` verified clean with the stub in place.

---

## Milestone 3 — Recognition, Notifications, Announcements, Documents, Events

### 3.1 Recognition leaderboard + Employee of the Month ✅ done (2026-07-14)

**What:** Weekly/monthly aggregation job computing `recognition_snapshots` per department: `score` (task points for Tech, target performance for Sales/BD — respect the M2.1 decision for how metric periods are read), `rank`, `is_employee_of_month` (true for department `rank = 1` in the monthly snapshot). Then implement `getEmployeeOfMonthStatus(employeeId, month, year)` for real.
**Why:** PRD §5.8. API_SPEC §6, §8. SCHEMA.md `recognition_snapshots`. Implementation Plan §5.
**Before building:** PRD §7 open question #3 (ties — single winner vs. multiple) is unresolved. Default assumption per PRD: single top performer, `rank = 1`. Note this assumption in `progress.md` if you proceed without stakeholder confirmation.
**Files:** `apps/web/app/api/v1/cron/recognition-snapshot/route.ts` (weekly/monthly job, cron-triggered), `apps/web/app/api/v1/recognition/route.ts` (GET leaderboard), ⚠️ **SHARED FILE** — `apps/web/lib/recognition/employee-of-month.ts` (same ownership note as 2.4 — flag Umang once real).
**RBAC:** GET /recognition = Any. Cron route should check a shared secret (`CRON_SECRET` from `.env.example`), not a user session.
**Definition of done:** After running the snapshot job against seed data, `GET /recognition?period_type=monthly&department_id=...` shows a ranked list with exactly one `is_employee_of_month = true` per department (under the single-winner assumption).

### 3.2 Notifications infrastructure ✅ done (2026-07-14)

**What:** A generic notification push service any module (including future Track A code) can call — e.g. `pushNotification(userId, type, message)` — plus the read/list API.
**Why:** PRD §5.10. API_SPEC §8. SCHEMA.md `notifications`.
**Files:** `apps/web/lib/notifications/push.ts` (new — not on the shared-file list since it doesn't exist yet in Phase 0, but genuinely reusable; mention it to Umang so Track A can call it later for e.g. "leave approved" notifications instead of building its own), `apps/web/app/api/v1/notifications/route.ts` (GET), `apps/web/app/api/v1/notifications/[id]/read/route.ts` (PATCH).
**RBAC:** Both endpoints = Any (self only — scope by session user).
**Definition of done:** Calling `pushNotification()` from the leave-approval flow (1.3) creates a row the requesting Employee can fetch via GET and mark read.

### 3.3 Announcements (team / all / specific-team scoping) ✅ done (2026-07-14)

**What:** CRUD respecting the three scopes from PRD §5.10: Team Lead → own team only (`scope_type = team`, forced); Admin/HR → `all` or `specific_teams`.
**Why:** PRD §5.10. API_SPEC §8. SCHEMA.md `announcements`.
**Files:** `apps/web/app/api/v1/announcements/route.ts` (GET, POST).
**RBAC:** enforce scope server-side — a Lead's POST must be rejected (or silently forced to `team`, pick one and be consistent) if they try to set `scope_type = all`/`specific_teams`; GET results filtered per user's team/role.
**Definition of done:** A Lead's attempt to POST an all-company announcement either 403s or is forced to `team` scope (document which); an HR-created `specific_teams` announcement is visible only to members of the listed teams.

**Implementation note:** A Lead's `scope_type` is silently forced to `team` (not 403'd) — `teamIds` is set to the Lead's own led team (`Team.teamLeadId = session.employeeId`), ignoring whatever the Lead sent. An Employee/BDE role attempting POST gets a straight 403 (not a Lead/Admin/HR role at all). `bun run build` clean. Live-verified: Tech Lead POSTing with `scope_type: "all"` was correctly forced to `team`/own-team-id; HR's `all` and `specific_teams` posts worked as requested; a Tech Employee's POST attempt 403'd; GET as Tech Employee returned the `all` + own-team `team` + own-team `specific_teams` announcements; GET as Sales Lead correctly excluded the Tech-team-scoped ones.

### 3.4 Employee Documentation upload ✅ done (2026-07-14)

**What:** Upload/list employee documents (ID proofs, contracts, etc.) collected at hiring time.
**Why:** PRD §5.10. API_SPEC §8. SCHEMA.md `employee_documents`. Needs S3/R2 (Implementation Plan §1) — env vars already scaffolded in `.env.example`.
**Files:** `apps/web/lib/storage/s3.ts` (new — S3/R2 upload helper; not on the shared-file list yet, but flag it to Umang as reusable infra since Track A doesn't currently have a file-upload need but might later), `apps/web/app/api/v1/employees/[id]/documents/route.ts` (GET, POST).
> ⚠️ **Folder overlap, not a shared file:** same note as 2.3 — new file under Track A's `app/api/v1/employees/` folder.
**RBAC:** Admin/HR (any employee's documents), Employee (self only).
**Definition of done:** Upload a test document via POST, confirm it round-trips through GET for the owning employee and for Admin, and confirm a *different* Employee gets 403/404 on GET.

**Implementation note:** `lib/storage/s3.ts` implements a presigned-upload helper (`getPresignedUploadUrl`/`buildFileUrl`, using `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, added as new deps) for future direct-to-bucket uploads, but the `/documents` route itself takes a `fileUrl` already uploaded by the client — same convention as `Request.attachmentUrl` from Milestone 2.4 — since `.env`'s S3 credentials are placeholder-only in this environment and no file bytes should pass through the Next.js server anyway. RBAC for POST is Admin/HR (any) + Employee (self) per the tasklist's DoD text, which is broader than API_SPEC.md §8's literal "POST = Admin/HR" line — flagged as an assumption, not confirmed with a stakeholder. `bun run build` clean. Live-verified: Tech Employee self-uploaded a document, HR uploaded a second document for the same employee, both GET as owning employee and GET as Admin returned both documents, and GET as a different employee (Sales Lead) correctly 403'd.

### 3.5 Event Management — birthday/anniversary banner + Meetings ✅ done (2026-07-14)

**What:** (a) Derived, not persisted: nightly cron checks `employees.date_of_birth`/`date_of_joining` against today, pushes notifications (via 3.2's service). `GET /events/today` serves the login banner. (b) Meetings: full CRUD, invitees (individual + team, expanded at send-time), configurable per-meeting `reminder_lead_minutes`, cron sends reminders at `scheduled_at − reminder_lead_minutes`.
**Why:** PRD §5.11. API_SPEC §8, §10. SCHEMA.md `events`, `event_invitees`.
**Before building:** PRD §7 open question #2 (reminder channel) — build in-app only (assume this per PRD's stated default) unless stakeholder says otherwise; note the assumption in `progress.md` if unconfirmed.
**Files:** `apps/web/app/api/v1/events/today/route.ts` (GET), `apps/web/app/api/v1/events/meetings/route.ts` (POST, GET), `apps/web/app/api/v1/events/meetings/[id]/route.ts` (PATCH, DELETE), `apps/web/app/api/v1/cron/birthday-check/route.ts`, `apps/web/app/api/v1/cron/meeting-reminders/route.ts`.
**RBAC:** GET today = Any. POST meeting = Admin/HR/Lead. PATCH/DELETE = Creator or Admin/HR. GET meetings = scoped to invitee (direct or via team).
**Definition of done:** Seed an employee with today's date_of_birth, confirm the cron endpoint creates a notification for all employees; create a meeting with a 15-min lead time and confirm the reminder cron only fires within that window (test with a near-future `scheduled_at`, not a live wait).

**Implementation note:** `events` has no persisted "reminder sent" flag — adding one would touch the shared schema for a single cron's bookkeeping — so `meeting-reminders` derives idempotency from `notifications` itself: each reminder is tagged `type = "meeting_reminder:<eventId>"` and skipped per-user if that tag already exists for them, so re-running inside the same open window is a no-op. `GET /events/today` is a pure derived query (no `events` rows persisted for birthday/anniversary), matching the PRD's stated default. Reminder channel is in-app only, per the PRD §7 open-question-#2 default (unconfirmed with a stakeholder, per the tasklist's running-assumptions list). `bun run build` clean. Live-verified: `events/today` returned empty at baseline, then correctly surfaced a seeded employee's birthday after setting `dateOfBirth` to today; `birthday-check` cron (secret-gated, 401 without it) pushed a notification to all 7 seeded users; a meeting created with a 10-minute-out `scheduledAt` and 20-minute `reminderLeadMinutes` (window already open) had its reminder fire on the first `meeting-reminders` cron run and correctly sent zero on a second run (idempotent); meeting PATCH/DELETE RBAC verified (creator and Admin allowed, a non-creator non-admin Lead 403'd); test `dateOfBirth` mutation reverted to `null` after verification.

---

## Milestone 4 — Integration week (joint with Track A)

**What:** Cross-test the two shared dependencies now that both stubs are real: Track A's payslip generation actually calls `getApprovedReimbursementTotal` and `getEmployeeOfMonthStatus` and gets correct numbers, not thrown errors. Full RBAC pass across all Track B screens (verify Employee/Lead/HR/Admin visibility boundaries match PRD §3 exactly). Shared bug bash.
**Why:** Implementation Plan §8 Milestone 4, §5.
**Files:** none new — this is testing/verification across both tracks' existing code.
**Definition of done:** Generate a real payslip (Track A) for an employee with an approved reimbursement and an Employee-of-the-Month flag, and confirm both values are correctly reflected — this is the actual proof the Phase 0 contract worked end-to-end.

---

## Assets stub (low priority)

**What:** `GET /assets` placeholder only — do not build real asset management (PRD §5.12, explicitly deferred).
**Files:** `apps/web/app/api/v1/assets/route.ts` (GET — returns empty/placeholder list).
**RBAC:** Admin/HR.
**Definition of done:** Endpoint exists and returns a valid (if empty) `{ data, error }` response; nothing more.

---

## Running list of assumptions made without stakeholder confirmation

Keep this in sync with `progress.md`'s open-decisions section as you resolve or assume your way past PRD §7 items:

- [ ] `bde_lead` role — not building lead-specific BD screens until confirmed (affects 3.1/3.3 team-lead flows for BD).
- [ ] Meeting reminder channel — building in-app only (3.5).
- [ ] Employee of the Month ties — building single-winner (`rank = 1`) only (3.1).
- [ ] Monthly metric-target reset approach — record your 2.1 decision here once made.
- [x] `POST /requests` scope — **resolved 2026-07-13** (stakeholder direction): requests work in hierarchy. Employees, Team Leads, and HR may all file their own leave requests; approval stays Admin/HR only (golden rule, unchanged). Leads' requests are approved by HR/Admin; HR's requests must go up to Admin (self-approval blocked in `approve`/`reject` by comparing the requester's linked `User.id` to the approving session's `userId`). Admin is intentionally excluded from `POST /requests` — there's no one above Admin to approve it, so an Admin-filed request would be permanently stuck pending.
