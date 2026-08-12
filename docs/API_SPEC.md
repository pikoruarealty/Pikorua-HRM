# Pikorua HRM — API Specification

> Companion to PRD.md and SCHEMA.md. All endpoints are implemented as Next.js Route Handlers (`app/api/.../route.ts`) or Server Actions where appropriate. Auth is JWT/session-based; every endpoint below lists which roles may call it. `Admin` and `HR` are treated identically everywhere ("Finance roles") unless noted.

**Conventions:**
- Base path: `/api/v1`
- All responses: `{ data, error }` shape. Errors: `{ data: null, error: { code, message } }`
- Auth via session cookie (or `Authorization: Bearer <token>`) — every route below requires authentication unless marked Public.
- Role shorthand: `Admin/HR` = finance roles, `Lead` = Team Lead roles, `Employee` = individual contributor roles, `Any` = any authenticated role.

**Parameter validation (2026-08-11).** Two rules hold across every route, backed by `lib/api/params.ts`:
- **A malformed `:id` returns `404 NOT_FOUND`, never `500`.** Every `:id` is a Postgres `uuid`; a non-UUID string makes Prisma throw P2023, which used to escape the handler as a bare, envelope-less 500 on **22 endpoints**. Ids are now checked with `isUuid()` before any query. 404 (not 422) is deliberate: a malformed id cannot name a row, and it keeps "doesn't exist" and "not yours" indistinguishable, matching the scoped read routes.
- **A malformed query filter returns `422 VALIDATION`, never a silently unfiltered list.** `uuidFilter` / `dateFilter` / `intFilter` / `enumFilter` return `undefined` when absent and `null` when present-but-invalid, so the route can tell "no filter" from "bad filter". Dropping a bad filter would answer 200 with every row the caller may see — a failed narrow search that looks like a successful broad one. `?month=99` is rejected for the same reason it used to return an empty list that read as "you have no payslips".

---

## 1. Auth

| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | `/auth/login` | Public | `{ email, password }` → session + user profile (id, role, employee_id). Rate-limited (5/15min per ip+email, 20/15min per ip → `429 RATE_LIMITED` + `Retry-After`); success/failure/blocked attempts are audited. |
| POST | `/auth/logout` | Any | |
| GET | `/auth/me` | Any | returns current user + role + employee profile summary |
| POST | `/auth/change-password` | Any (self) | `{ current_password, new_password }` — re-verifies the current password; policy: ≥10 chars, mixed case, a digit. Audited. Added 2026-07-15 (production hardening). |

---

## 2. Employees & Org Structure — **Track A**

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/employees` | Admin/HR (all), Lead (own team only), Employee (self only) | Query filters: `department_id`, `team_id` (uuid), `status`, `role`, `employment_type` (enum), `q` (name/email/phone substring). Each is **422 on a malformed value**, not ignored. Response scoped server-side by role — do not rely on frontend filtering. |
| GET | `/employees/:id` | Admin/HR (any), Lead (if in own team), Employee (self only) | Responses include `photoUrl` (authenticated serving path) since 2026-07-15. Since 2026-08-10 also includes `dailyCallTarget`, `monthlySiteVisitTarget`, `monthlyBookingTarget` (the per-employee sales-target overrides) — not golden-rule data, so they're on the public select for anyone who can see the employee at all; edited only via `PATCH /employees/:id/sales-targets`, never here. |
| POST | `/employees` | Admin/HR | **multipart/form-data since 2026-07-15**: employee fields as form fields + a **required `photo` image file** (JPEG/PNG/WebP ≤ 5MB). JSON bodies are rejected with 422. |
| PATCH | `/employees/:id` | Admin/HR | Editable: salary, department, team, status, device_uid mapping |
| PATCH | `/employees/:id/sales-targets` | Admin/HR, **or the Lead who owns this employee's team** | Added 2026-08-10. `{ daily_call_target?, monthly_site_visit_target?, monthly_booking_target? }` (strict; each nullable to clear back to org default). Deliberately a separate route from `PATCH /employees/:id` so the golden-rule gate on salary/role stays Admin/HR-only while a Lead can still tune their own team's targets. 422 if the employee's department `type_key` is `tech` (sales targets only apply to metric/sales departments). Audited (`employee.sales_targets_update`). |
| DELETE | `/employees/:id` | Admin | Soft-delete (status → inactive) |
| GET | `/employees/:id/hard-delete` | Admin | Pre-flight for the route below: `{ assignedWorkItems, ledWorkUnits, finalizedPayslips }` — used by the UI to decide whether to show the reassignment picker and whether the delete is currently blocked. |
| DELETE | `/employees/:id/hard-delete` | Admin | **Permanent removal.** Only reachable once the employee is already soft-deleted (409 otherwise). 409 if the employee has any `finalized` payslips — a permanent payroll record that the ordinary `DELETE /payslips/:id` route already refuses to touch, so this route can't be a back door around that; unfinalize them first. If the employee has assigned work items or led projects, `{ reassign_to }` (an active employee id) is required or it 409s with `requiresReassignment: true`. Reassigns or orphan-cleans work, nullifies actor references (audit logs, approvals) rather than deleting them, deletes the linked `User`. Audited (`employee.hard_delete`). |
| GET | `/employees/:id/photo` | Any | Serves the profile photo bytes (photos appear in lists/calendar for every role — not golden-rule data). 404 if none. |
| POST | `/employees/:id/photo` | Admin/HR | multipart `photo` file — upload/replace (also backfills pre-requirement employees). Audited. |
| GET | `/departments` | Any | Returns departments + their `department_labels` config |
| POST | `/departments` | Admin | `{ name, type_key }` |
| GET | `/departments/:type_key/labels` | Any | Returns work_unit/sub_unit/work_item label mapping for that department type |
| PUT | `/departments/:type_key/labels` | Admin | Update label config — this is how a new department's terminology is configured |
| GET | `/teams` | Admin/HR (all), Lead/Employee (own department) | |
| POST | `/teams` | Admin/HR | `{ department_id, name, team_lead_id }` |
| PATCH | `/teams/:id` | Admin/HR | reassign lead, rename |

---

## 3. Attendance — **Track A**

> **Manual clock-in/clock-out + HR/Admin approval.** A day is one `attendance_records` row plus one or more `attendance_sessions` (see SCHEMA §3) — clocking out closes the current session, it does not end the day. The TeamOffice biometric feed is in scope and lands on the same session shape.

| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | `/attendance/clock-in` | Employee | Server-timestamped. Body (optional): `{ workItemIds?: uuid[], workLocation?: "office" \| "wfh" }`, `.strict()`. Opens a new **session** on today's record, creating the record (and setting `clock_in_raw` + `work_location`) if this is the day's first. Re-clock-in after a clock-out is allowed and reopens the day (`clock_out_raw`/`total_hours` back to `null`); it never moves `clock_in_raw`. `409` if a session is already open, or if the day is already **approved** (Admin/HR must reopen it). Picking ≥1 task is required only on the day's **first** clock-in, and only when the employee has active tasks. Returns the record plus `currentSession`. **WFH notify-then-async-approve (2026-08-12):** on the day's first `workLocation: "wfh"` clock-in, notifies every Admin/HR user (`notifyFinanceUsers`) and audits `attendance.wfh_clock_in` — no blocking gate, the employee's day proceeds exactly like an office day; approval happens later via the existing `PATCH /attendance/:id/approve`. |
| POST | `/attendance/clock-out` | Employee | Server-timestamped. Body (optional): `{ endOfDay?: boolean }` (default `true`), `.strict()`. Closes the open session and re-sums `total_hours` from **all** the day's sessions (breaks excluded). `endOfDay: false` = stepping out for a break: no EOD wrap-up notification to self or management. `409` if no session is open. Returns `{ record, eod, endOfDay }`. |
| GET | `/attendance` | Admin/HR (all), Lead (own team), Employee (self) | filters: `employee_id`, `date_from`, `date_to`, `approval_status`. Each record includes its `sessions` (`id`, `clockIn`, `clockOut`, `workLocation`), oldest first — an open session is how a client tells "on a break" from "done for the day". |
| GET | `/attendance/:employee_id/summary` | Admin/HR, Lead (own team), Employee (self) | monthly summary: total late count, half-days, unpaid leave days — computed from **approved** records only, feeds payroll |
| PATCH | `/attendance/:id/edit` | Admin/HR | Edits `clock_in_approved`/`clock_out_approved` (e.g., correcting a forgotten clock-out) |
| PATCH | `/attendance/:id/approve` | Admin/HR | Sets `approval_status = approved`, `approved_by`, `approved_at`. If not separately edited first, approved times default to the raw values. |
| DELETE | `/attendance/:id` | Admin/HR | Permanent removal — strictly for phantom/incomplete records with no clock-in/out (e.g. an employee-creation side effect). **409 if the record is approved, or has any clock-in/out data** (2026-08-11 — the route's own comment always claimed this guard existed; it did not, until now). Approved or real-punch records must be unapproved first, not deleted. Audited (`attendance.delete`). |
| GET | `/attendance/overview` | Admin/HR | Added 2026-07-15. One-day glance: `?date=YYYY-MM-DD` (default today) → `{ date, holiday, counts: { total, present, halfDay, onLeave, absent, late, pendingApproval }, rows: [per-employee status] }`. A holiday date suppresses "absent". |
| POST | `/attendance/manual` | Admin/HR | Added 2026-07-15 (manual override), widened to Admin/HR 2026-08-07. `{ employee_id, date, clock_in, clock_out?, reason, override? }` — creates/overwrites the record's **approved** times, written pre-approved with the entering user as approver; raw clock values never touched. `409` if the date is already `source: device_sync` and `override` is not `true` (2026-08-12, Phase 28 — a biometric-reconciled day is never silently clobbered by a plain manual entry). Audited (`attendance.manual_create` / `attendance.manual_override`). |
| POST | `/attendance/manual/bulk` | Admin/HR | Added 2026-08-07. Multi-employee × multi-date sibling of `/attendance/manual`; `{ reason, records: [{ employee_id, date, clock_in, clock_out?, override? }] }`, per-row `override` guard same as the single-record route, returns per-row success/failure. |
| GET | `/attendance/task-progress` | Admin/HR (all), Lead (every team they lead + self) | Added 2026-07-23. Live "what is everyone doing right now" view: `?date=YYYY-MM-DD` (default today) → `{ date, rows: [{ employeeId, fullName, photoUrl, clockIn, clockOut, plannedCount, completedCount, inReviewCount, pointsEarnedToday, items: [EodItem] }] }`, one call for the whole scoped team instead of querying `/attendance/eod` per employee. |

---

## 4. Project / Task Tracking (WorkUnit → SubUnit → WorkItem) — **Track B**

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/work-units` | Admin/HR (all), Lead (own department), Employee (assigned or own department, status-only view) | filters: `department_id` |
| POST | `/work-units` | Lead, Admin/HR | Creates a Project/Campaign; `team_lead_id` defaults to creator if Lead |
| GET | `/work-units/:id` | Any (scoped) | nested response includes sub_units + work_items |
| PATCH | `/work-units/:id` | Lead (own), Admin/HR | status changes, rename |
| DELETE | `/work-units/:id` | Lead (own), Admin/HR | Soft delete (2026-07-18) — cascades to its sub_units and work_items |
| POST | `/work-units/:id/sub-units` | Lead (own work_unit), Admin/HR | `{ name }` |
| GET | `/sub-units/:id` | Lead (own), Admin/HR | (2026-07-18) |
| PATCH | `/sub-units/:id` | Lead (own), Admin/HR | (2026-07-18) `{ name }` — rename |
| DELETE | `/sub-units/:id` | Lead (own), Admin/HR | (2026-07-18) soft delete — cascades to its work_items |
| POST | `/sub-units/:id/work-items` | Lead (own), Admin/HR | `{ title, assigned_to, mode, description?, dueDate?, task_points? , target_value?, frequency? , period_month?, period_year? }` — `description` = acceptance criteria, `dueDate` = `YYYY-MM-DD` (both 2026-08-08, optional, both modes); Lead sets task_points for atomic mode; metric mode requires `frequency` (`daily`\|`monthly`, 2026-07-18): `monthly` requires `period_month`/`period_year`, `daily` computes the period server-side (always "today"); `repeatDaily?` (bool, 2026-08-10) is **atomic-only** — the item is cloned forward as a fresh pending task every morning by the daily-rollover cron, and is given today's due date if none was supplied (a daily metric item already rolls forward, so the flag is ignored there) |
| PATCH | `/work-items/:id` | Assigned Employee (status/current_value only, requires the assignee to be currently clocked in — 2026-07-18), Lead (all fields) | Employees update their own task's status (atomic) or current_value (metric); Leads can reassign/edit points/title/target, plus `description`/`dueDate` (2026-08-08 — management-only, send `null` to clear either). **Tiered review (2026-08-08):** an assignee setting `status: "completed"` on a task above the threshold submits it for review instead (same rule as `/complete`); a Lead setting it credits immediately — their edit *is* the review. Assignees cannot set `in_review` by hand, nor touch a task that is already in review (403). `repeatDaily` (2026-08-10) is management-only like title/points and atomic-only (422 on a metric item) — clearing it on the newest instance is how a standing daily task is stopped. |
| DELETE | `/work-items/:id` | Lead (own), Admin/HR | Soft delete (2026-07-18) — the points ledger keeps its row for audit |
| GET | `/work-items/mine` | Employee, Lead, HR | tasks assigned to the current employee, across work units. HR included since 2026-08-11 (HR clocks in and works day-to-day like an employee; Admin does not and stays excluded). |

---

## 5. Daily Planning / EOD — **Track B**

| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | `/daily-selections` | Employee, Lead (self-service on own assigned items) | `{ workItemIds: uuid[] }` (camelCase — this route and `/attendance/clock-in`'s task-selection body are the two documented exceptions to the snake_case convention used elsewhere; corrected here 2026-08-11, the doc previously said `work_item_ids`, which 422s against the real route). Additive (`skipDuplicates`), for today only. |
| GET | `/daily-selections/today` | Employee, Lead (own team), HR (own, scoped like Employee) | HR included since 2026-08-11, same reasoning as `/work-items/mine`. |
| POST | `/work-items/:id/complete` | Employee (if assigned) | Marks atomic task completed → triggers point ledger credit (server-side, not client-computed). Requires the assignee to be currently clocked in (2026-07-18). **Tiered review (2026-08-08):** if `task_points` exceeds `WORK_ITEM_REVIEW_THRESHOLD` (default 3), the task moves to `in_review` instead and **no points are credited** — response is `{ workItem, pointsCredited: null, awaitingReview: true }`; below the threshold it is unchanged (`{ workItem, pointsCredited, awaitingReview: false }`). 409 if the task is already completed or already in review. **Self-logged tasks (2026-08-10) always go to `in_review`, whatever they are worth** — the threshold does not apply to them. |
| POST | `/work-items/:id/review` | Lead (own WorkUnit), Admin/HR | Added 2026-08-08. `{ action: "accept" \| "reject", points?, note? }`. `accept` sets the task `completed` and writes the point-ledger row (`points` defaults to `task_points`); `reject` returns it to `wip`. `note` is **required** to reject, and required to accept for fewer points than the task is worth. 409 unless the task is in `in_review`. Audited (`work_item.review_accept` / `work_item.review_reject`); notifies the assignee. **Sending `points` for a self-logged task is a 422 (2026-08-10)** — it is worth its type's points; accept it or send it back, but don't re-price it. |
| POST | `/work-items/self-log` | Employee **with a department** | Added 2026-08-10. `{ typeKey, title, description? }` — strict body, so a client-supplied `points` is rejected outright (422). The employee must be **currently clocked in** (422 if not); Admin/HR have no department and get 403 (checked *before* the clock-in test, since "not your feature" is a permanent answer and "clock in" is a transient one). Points are copied server-side from the `adhoc_task_types` row — the client never sends a number. Creates a `pending`, `selfLogged` atomic WorkItem due today, hung off the per-department auto-provisioned **"Ad-hoc Work" → "Self-logged Tasks"** container (created on first use, project lead = a department Lead, or the first active member if lead-less; 422 if the department has no active members). Audited (`work_item.self_log`). |
| GET | `/work-items/self-log` | Employee | Added 2026-08-10. The caller's own last 50 self-logged tasks with `{ status, taskPoints, awaitingReview, reviewNote, type }` — enough to show what is pending a Lead's confirmation without loading the work tree. |
| GET | `/adhoc-task-types` | Any authenticated user | Added 2026-08-10. The self-logged point catalog (`key`, `label`, `points`). Active-only; `?includeInactive=1` is honoured for Admin/HR only. |
| POST | `/adhoc-task-types` | Admin/HR | Added 2026-08-10 (Commit 7). `{ key, label, points, sort_order? }` — strict body. `key` must be lowercase snake_case (`^[a-z][a-z0-9_]*$`) and is **permanent** once created (no rename route — WorkItems reference it). 409 on a duplicate `key`. Audited (`adhoc_task_type.create`). |
| PATCH | `/adhoc-task-types/:id` | Admin/HR | Added 2026-08-10 (Commit 7). `{ label?, points?, active?, sort_order? }` — strict body, `key` is deliberately excluded (immutable). 404 on a malformed or unknown id. `active: false` retires a type without deleting it (existing WorkItems keep their historical points). Audited (`adhoc_task_type.update`). |
| GET | `/work-items/review-queue` | Lead (own WorkUnits), Admin/HR (all) | Added 2026-08-08. Every task in `in_review` the caller can act on, oldest submission first, with assignee + project context. Self-scoping — returns `[]` rather than 403 for anyone who leads nothing. |
| GET | `/employees/:id/points` | Admin/HR, Lead (own team), Employee (self) | returns point ledger + running balance |
| GET | `/employees/:id/task-activity` | Admin/HR, Lead (own team), Employee (self) | Added 2026-07-23. `?period=daily\|weekly\|monthly\|total` (default `daily`), optional `?date=YYYY-MM-DD` anchor. Returns `{ summary: { period, from, to, tasksTouched, tasksCompletedInPeriod, pointsEarnedInPeriod, daysActiveInPeriod }, tasks: [{ workItemId, title, projectName, subUnitName, mode, status, taskPoints, assignedAt, completedAt, daysSelectedInPeriod, pointsEarnedInPeriod }] }` — every task the employee planned or completed in the period, enriched with which Project/SubUnit it belongs to. Distinct from `/employees/:id/work-items/history`, which is metric-mode growth tracking only. |

---

## 6. Payroll — **Track A**

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/payroll/config` | Admin/HR | the late-deduction percentage (2026-07-17 — half-day/unpaid-leave/absent are fixed fractions of a day's pay, not configured here) |
| PUT | `/payroll/config` | Admin | `{ late_deduction_percent, late_grace_minutes, effective_from }` — update the rate + late-grace window (versioned by `effective_from`) |
| GET | `/sales/target-config` | Admin/HR | Added 2026-08-10 (Commit 7). The current `sales_target_config` (daily call / monthly site-visit / monthly booking org-wide defaults, `auto_assign_daily_calls`), resolved as of now. |
| PUT | `/sales/target-config` | Admin | Added 2026-08-10 (Commit 7). `{ daily_call_target, monthly_site_visit_target, monthly_booking_target, auto_assign_daily_calls, effective_from }` — versioned like `/payroll/config` (always inserts a new row, never updates in place, so a past period's attainment stays computed against the settings actually in force then). Audited (`sales_target_config.update`). |
| GET | `/performance/config` | Admin/HR | Added 2026-08-10 (Commit 7). The current `performance_config` (`scoring_enabled`, `self_logged_cap_percent`), resolved as of now. |
| PUT | `/performance/config` | Admin | Added 2026-08-10 (Commit 7). `{ scoring_enabled, self_logged_cap_percent, effective_from }` — versioned the same way. Audited (`performance_config.update`). |
| GET | `/payslips/:employee_id/employee-of-month-status` | Admin/HR | Quick lookup: was this employee Employee of the Month for their department this period? (from `recognition_snapshots.is_employee_of_month`) — reference only. Superseded for the generate screen's own use by `POST /payslips/preview`, which returns the same flag alongside the full breakdown |
| POST | `/payslips/preview` | Admin/HR | Added 2026-07-17. `{ employee_id, month, year, incentive_amount?, bonus_amount?, other_addition_amount?, other_deduction_amount? }` — **read-only**, computes the same earned-pay breakdown + net pay as `/payslips/generate` (shared `lib/payroll/payslip-preview.ts`) without persisting anything, so the UI can show a live projection before the user commits |
| POST | `/payslips/generate` | Admin/HR | `{ employee_id, month, year, incentive_amount, bonus_amount, bonus_reason?, other_addition_amount?, other_addition_reason?, other_deduction_amount?, other_deduction_reason? }` — server computes `earned_base_pay` from **approved** attendance (present/half-day/paid-leave/holiday/compensation days paid; absent/unpaid-leave excluded) + a late-arrival penalty + reimbursements from approved requests, and denormalizes `employee_of_month_ref` |
| GET | `/payslips` | Admin/HR (all), Employee (self only, finalized only) | filters: `employee_id`, `month`, `year` |
| GET | `/payslips/:id` | Admin/HR (any), Employee (self only, finalized only) | 403 for a draft — even the owner's own — with a distinct message ("has not been finalized yet") from the not-yours 403, so the two don't look identical (2026-08-11 fix). |
| PATCH | `/payslips/:id/finalize` | Admin/HR | draft → finalized |
| PATCH | `/payslips/:id/unfinalize` | **Admin only** | Added 2026-07-15 (manual override). finalized → draft; `{ reason }` required, audited. |
| DELETE | `/payslips/:id` | **Admin only** | Added 2026-07-15 (manual override). Drafts only (409 otherwise) — the unfinalize → delete → regenerate correction flow. Audited. |

---

## 7. Requests (generic — leave, reimbursement, WFH, etc.) — **Track B**

| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | `/requests` | Employee (not Admin — nobody could approve it) | JSON `{ type, dateFrom?, dateTo?, amount?, description? }`, **or** `multipart/form-data` with the same fields plus a `bill` file (reimbursement only; PDF/PNG/JPEG/GIF/WebP, ≤10MB). Body is **strict** — unknown keys are rejected. `attachment_url` is **not** accepted from the client (2026-08-11): it is an opaque storage key minted server-side from the uploaded file, and accepting it let a submitter point their own request at any other file under `uploads/`. |
| GET | `/requests` | Admin/HR (all), Lead (own team), Employee (self) | filters: `type`, `status`, `employee_id` |
| GET | `/requests/:id` | scoped as above | |
| PATCH | `/requests/:id/approve` | **Admin/HR only** (all request types, including leave and reimbursement — Team Leads cannot approve) | sets status + approver_id + approved_at |
| PATCH | `/requests/:id/reject` | **Admin/HR only** | same as approve |
| PATCH | `/requests/:id/override` | **Admin only** | Added 2026-07-15 (manual override). Force any status (`pending`/`approved`/`rejected`) regardless of current state; `{ status, reason }` required; requester notified; audited (`request.override`). |

---

## 8. Recognition, Notifications, Announcements, Documentation, Events — **Track B**

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/recognition` | Any | filters: `period_type` (weekly/monthly), `department_id` — leaderboard view, includes `is_employee_of_month` flag. **Changed 2026-08-08 (Pillar 6):** each `monthly` row now also carries `components` (the composite score breakdown — null on `weekly` rows and pre-Pillar-6 data). Kept visible to any authenticated user by deliberate owner decision — the leaderboard stays public rather than narrowing to self/Lead/Admin as the plan originally proposed |
| GET | `/performance-reviews/queue` | Any (self-scoping) | Added 2026-08-08 (Pillar 3). `?year=&month=` (defaults to the current month). The caller's monthly-review worklist: employees they may review, each with **their own** review for the period or `null`, plus a `{ reviewable, reviewed, pending }` summary. Admin/HR see everyone, a Lead sees their team, everyone else gets an empty list (not a 403). Future periods → 422 |
| GET | `/employees/:id/performance-review` | Self, owning Lead, Admin/HR | Added 2026-08-08. Full multi-reviewer history + `{ reviewCount, averageRating, latestRating }`. Each row carries `canEdit` for the caller |
| POST | `/employees/:id/performance-review` | Owning Lead, Admin/HR — **never self** | Added 2026-08-08. `{ rating (1-5), note?, periodYear?, periodMonth? }` (period defaults to the current month). 409 on a repeat for the same (employee, reviewer, period); 422 for a future period or one before the employee joined. Audited as `performance_review.create` |
| PATCH | `/performance-reviews/:id` | The review's author, **or Admin** | Added 2026-08-08. `{ rating?, note? }` (`note: null` clears it) — the only way a rating changes after the fact, since creating a duplicate is a 409. A Lead can never rewrite another reviewer's row. Audited as `performance_review.update` with the previous rating |
| GET | `/notifications` | Any (self) | current user's notifications |
| PATCH | `/notifications/:id/read` | Any (self) | |
| GET | `/announcements` | Any | server scopes results: all-company + specific-team announcements matching the user's team + team announcements for the user's own team |
| POST | `/announcements` | Lead (own team only — `scope_type` forced to `team`), Admin/HR (`scope_type` = `all` or `specific_teams`) | `{ title, body, scope_type, team_ids? }` |
| DELETE | `/announcements/:id` | **Admin only** | Added 2026-07-15 (manual override). Audited. |
| GET | `/employees/:id/documents` | Admin/HR (any), Employee (self) | |
| POST | `/employees/:id/documents` | Admin/HR | upload at hiring time or later |
| GET | `/events/today` | Any | returns today's birthdays/anniversaries (derived query, see Schema doc) for the login banner |
| POST | `/events/meetings` | Admin, HR, Lead | `{ title, scheduled_at, reminder_lead_minutes, invitee_employee_ids?, invitee_team_ids? }` |
| GET | `/events/meetings` | Any (scoped to meetings the user is invited to, directly or via their team) | |
| PATCH | `/events/meetings/:id` | Creator, Admin/HR | reschedule, edit invitees, edit reminder lead time |
| DELETE | `/events/meetings/:id` | Creator, Admin/HR | |

---

## 8b. Holidays & Calendar (added 2026-07-15) — **Track A**

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/holidays` | Any | Company holiday list; `?year=` filter. |
| POST | `/holidays` | Admin/HR | `{ date: "YYYY-MM-DD", name }` — one holiday per date (409 on duplicate). Audited (`holiday.create`). |
| DELETE | `/holidays/:id` | Admin/HR | Audited (`holiday.delete`). |
| GET | `/calendar` | Any (server-scoped) | `?month=&year=` (default current) → `{ month, year, items }` — everything with a date in one feed for the `/calendar` page: **holidays** + **birthdays/anniversaries** (everyone, celebratory), **meetings** (Admin/HR all; others only created/invited, same scoping as `/events/meetings`), **leave** (approved + pending `leave_*` requests: Admin/HR all, Lead own team, Employee self; multi-day leave expanded to one item per day). |

## 8c. Sales Activity (added 2026-08-10, overhaul Pillars 4/5)

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/sales/offline-claims` | Any (server-scoped) | Offline-call claims: Admin/HR all, Lead their led teams + self, everyone else self only. `?status=pending\|approved\|rejected`. |
| POST | `/sales/offline-claims` | Any employee (self only) | `{ date, calls, note }`. Files a claim **for yourself** — the employee is taken from the session, never the body. Rejects future dates, dates more than 14 days back, and any claim that would push the day's pending+approved total past 500. `note` is required. Audited (`sales.offline_claim_create`). |
| POST | `/sales/offline-claims/:id/review` | Owning Lead, or Admin/HR — **never the claimant** | `{ action: "approve" \| "reject", note? }`. `note` required to reject. Self-approval is refused even for an Admin reviewing their own claim; second review 409s. On success recomputes the day's call total (CRM + approved claims — recomputed, never incremented) into the rep's `WorkItem`. Audited (`sales.offline_claim_approve` / `sales.offline_claim_reject`). |
| GET | `/sales/team-progress` | Any (server-scoped, same shape as `/attendance/task-progress`) | `?date=YYYY-MM-DD` (default today) → per-rep today's calls (split `crm` / `offline` / `total`) vs. daily target, plus this month's site visits and bookings vs. a **pro-rated** monthly target, with team totals and an `unmatchedCrmRows` count. Pacing cross-references weekly offs (including `WeeklyOffMove`), public holidays and approved leave via `lib/attendance/monthly-breakdown.ts`, so nobody reads as behind on their day off or while on approved leave. Admin/HR see everyone; a Lead sees their led teams + self; a rep sees only their own row. |

> **Sales activity is not a parallel data path.** The CRM feed lands in `sales_activity_sync` and is projected into ordinary `WorkItem.currentValue` by `lib/sales/write-through.ts` (the only writer). Every other endpoint — progress, scoring, the team dashboard — reads WorkItems and cannot tell a CRM number from a hand-entered one.

## 9. Assets (stub) — **Track B (low priority)**

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/assets` | Admin/HR | placeholder, not built out in v1 |

---

## 9b. Operations & Audit (production hardening, added 2026-07-15)

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/api/health` | Public | **Not under `/api/v1`.** Liveness/readiness probe: `{ status, db }`, `503` if the DB is down. No auth, no version info. |
| GET | `/audit-logs` | **Admin only** (narrower than Admin/HR — HR's own actions are part of the trail) | Append-only audit trail. Filters: `action` (prefix match), `actor_user_id`, `entity_type`, `entity_id`, `date_from`, `date_to`; paginated (`page`, `limit` ≤ 200). Rows are written by `audit()` from `@/lib/audit` — see CLAUDE.md conventions for which mutations must audit. |
| GET | `/device-mapping/unmatched` | **Admin only** | Added 2026-08-12 (Phase 28). TeamOffice Empcodes seen in `device_punch_raw` (unreconciled) with no `Employee.device_uid` match, each with a live-fetched name (`DownloadPunchDataMCID`) and up to 3 name-similarity suggestions against unmapped active employees (`lib/util/string-similarity.ts`). Read-only — nothing here writes anything. |
| POST | `/device-mapping/confirm` | **Admin only** | Added 2026-08-12 (Phase 28). `{ deviceUid, employeeId }` — the human-confirm half of suggest-and-confirm; app-level uniqueness check (deviceUid is not DB-unique), writes `Employee.device_uid`, immediately reconciles that Empcode's full unreconciled backlog rather than waiting for the next scheduled sync. Audited (`employee.device_mapping_confirm`). |

## 10. Cross-cutting: Scheduled Jobs (not user-facing endpoints, but must exist)

These run via a lightweight cron mechanism (see Implementation Plan §6 — no LAN-dependent worker needed in v1):

- **On clock-out**: re-sum `total_hours`/`is_half_day` for the day's `attendance_records` row from its sessions (does not require approval first, but payroll only counts `approved` rows). While a session is open both are `null`/`false` — the day isn't finished.
- **Daily (EOD cleanup)**: `lib/cron/attendance-eod-cleanup.ts` deletes empty phantom records for past dates and closes any past day left with an **open session**, defaulting each unclosed session's clock-out from that session's own start (team expected start + 9h, else 20:00) and re-summing the day.
- **Nightly**: check `date_of_birth`/`date_of_joining` against today's date → populate `events/today` cache + push birthday/anniversary notifications.
- **Recurring, per-meeting**: at `scheduled_at − reminder_lead_minutes`, push a reminder notification to all invitees (individual + expanded team invitees) of each upcoming meeting.
- **Hourly (added 2026-08-10, Pillar 4)**: `lib/cron/crm-sync.ts` at `15 * * * *` (plus a boot-time run) pulls `GET https://crm.pikoruarealty.com/api/hrm/activity?from=&to=` with a Bearer `CRM_API_KEY`, upserts a 2-day lookback window into `sales_activity_sync`, writes through into each matched rep's `WorkItem`s, then re-provisions any missing sales targets. Unmatched rows are kept, flagged, and WARN-logged — never guessed onto a rep. ⚠️ The CRM is IP-allowlisted to the production VM, so a 401 from a dev machine is the allowlist, not a bad key.
- **Daily 00:10 UTC**: `lib/cron/metric-daily-rollover.ts` clones daily metric items forward and (since 2026-08-10) `repeatDaily` atomic items too, then provisions each active sales rep's daily/monthly targets.
- **Weekly**: compute `recognition_snapshots.score` from point ledger (Tech) / metric task performance (Sales/BD, scoped per department per the monthly target reset), and flag `is_employee_of_month` for each department's monthly top performer.
- **Monthly (changed 2026-08-08, Pillar 6; department-aware weights + grace-period gate wired 2026-08-11)**: `score` is a 0–100 weighted composite, with the breakdown stored in `components`. Weights differ by department (`lib/performance/composite.ts`): **Tech** — output 50 (points vs department top scorer), quality 17, attendance 17, timeliness 8, commitments-kept 8. **Sales** — output 10 (daily calls attainment) + `salesOutcome` 40 (site visits + bookings blended 17:23, both pro-rated to the elapsed part of the month — see `lib/sales/pacing.ts`), quality 20, attendance 20, commitments-kept 10, timeliness 0. Publication is gated by `performance_config.scoring_enabled` (default off) — while off, the monthly snapshot writes nothing for that period; weekly is never gated. `performance_config.self_logged_cap_percent` is applied before the Tech output component is built (`gatherMonthlyInputs()` in `lib/performance/monthly-score.ts`), so ad-hoc self-logged work can't out-earn its cap. A metric `WorkItem` with `target_value = 0` is treated as unmeasurable (`null`), never as 0% attainment.
- **Monthly** (triggered manually by HR via `/payslips/generate`, not fully automatic in v1 per PRD): aggregate late/leave/half-day counts (from approved attendance only) for deduction calculation, and look up `is_employee_of_month` for reference display.
- **Every 2 minutes (added 2026-08-12, Phase 28)**: `lib/integrations/teamoffice/sync.ts` (`runDeviceSync`, exposed at `POST /api/v1/cron/device-sync`, `CRON_SECRET`-gated) polls TeamOffice's `DownloadLastPunchData` from the persisted `device_sync_cursor`, ingests new punches into `device_punch_raw` (`skipDuplicates`), then reconciles only the `(deviceUid, date)` pairs this run touched (`lib/integrations/teamoffice/reconcile.ts`) into `attendance_sessions` — never overwriting an existing WFH day or an already-approved manual day (see SCHEMA §3 `device_punch_raw`). Skips quietly if `TEAM_OFFICE_*` env vars aren't configured.
