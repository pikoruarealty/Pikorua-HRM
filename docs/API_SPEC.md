# Pikorua HRM — API Specification

> Companion to PRD.md and SCHEMA.md. All endpoints are implemented as Next.js Route Handlers (`app/api/.../route.ts`) or Server Actions where appropriate. Auth is JWT/session-based; every endpoint below lists which roles may call it. `Admin` and `HR` are treated identically everywhere ("Finance roles") unless noted.

**Conventions:**
- Base path: `/api/v1`
- All responses: `{ data, error }` shape. Errors: `{ data: null, error: { code, message } }`
- Auth via session cookie (or `Authorization: Bearer <token>`) — every route below requires authentication unless marked Public.
- Role shorthand: `Admin/HR` = finance roles, `Lead` = Team Lead roles, `Employee` = individual contributor roles, `Any` = any authenticated role.

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
| GET | `/employees` | Admin/HR (all), Lead (own team only), Employee (self only) | Query filters: `department_id`, `team_id`. Response scoped server-side by role — do not rely on frontend filtering. |
| GET | `/employees/:id` | Admin/HR (any), Lead (if in own team), Employee (self only) | Responses include `photoUrl` (authenticated serving path) since 2026-07-15 |
| POST | `/employees` | Admin/HR | **multipart/form-data since 2026-07-15**: employee fields as form fields + a **required `photo` image file** (JPEG/PNG/WebP ≤ 5MB). JSON bodies are rejected with 422. |
| PATCH | `/employees/:id` | Admin/HR | Editable: salary, department, team, status, device_uid mapping |
| DELETE | `/employees/:id` | Admin | Soft-delete (status → inactive) |
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
| POST | `/attendance/clock-in` | Employee | Server-timestamped. Body (optional): `{ workItemIds?: uuid[], workLocation?: "office" \| "wfh" }`, `.strict()`. Opens a new **session** on today's record, creating the record (and setting `clock_in_raw` + `work_location`) if this is the day's first. Re-clock-in after a clock-out is allowed and reopens the day (`clock_out_raw`/`total_hours` back to `null`); it never moves `clock_in_raw`. `409` if a session is already open, or if the day is already **approved** (Admin/HR must reopen it). Picking ≥1 task is required only on the day's **first** clock-in, and only when the employee has active tasks. Returns the record plus `currentSession`. |
| POST | `/attendance/clock-out` | Employee | Server-timestamped. Body (optional): `{ endOfDay?: boolean }` (default `true`), `.strict()`. Closes the open session and re-sums `total_hours` from **all** the day's sessions (breaks excluded). `endOfDay: false` = stepping out for a break: no EOD wrap-up notification to self or management. `409` if no session is open. Returns `{ record, eod, endOfDay }`. |
| GET | `/attendance` | Admin/HR (all), Lead (own team), Employee (self) | filters: `employee_id`, `date_from`, `date_to`, `approval_status`. Each record includes its `sessions` (`id`, `clockIn`, `clockOut`, `workLocation`), oldest first — an open session is how a client tells "on a break" from "done for the day". |
| GET | `/attendance/:employee_id/summary` | Admin/HR, Lead (own team), Employee (self) | monthly summary: total late count, half-days, unpaid leave days — computed from **approved** records only, feeds payroll |
| PATCH | `/attendance/:id/edit` | Admin/HR | Edits `clock_in_approved`/`clock_out_approved` (e.g., correcting a forgotten clock-out) |
| PATCH | `/attendance/:id/approve` | Admin/HR | Sets `approval_status = approved`, `approved_by`, `approved_at`. If not separately edited first, approved times default to the raw values. |
| GET | `/attendance/overview` | Admin/HR | Added 2026-07-15. One-day glance: `?date=YYYY-MM-DD` (default today) → `{ date, holiday, counts: { total, present, halfDay, onLeave, absent, late, pendingApproval }, rows: [per-employee status] }`. A holiday date suppresses "absent". |
| POST | `/attendance/manual` | **Admin only** | Added 2026-07-15 (manual override). `{ employee_id, date, clock_in, clock_out?, reason }` — creates/overwrites the record's **approved** times, written pre-approved with the admin as approver; raw clock values never touched. Audited (`attendance.manual_create` / `attendance.manual_override`). |
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
| GET | `/work-items/mine` | Employee | tasks assigned to the current employee, across work units |

---

## 5. Daily Planning / EOD — **Track B**

| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | `/daily-selections` | Employee | Called at clock-in: `{ work_item_ids: [] }` for today |
| GET | `/daily-selections/today` | Employee, Lead (own team) | |
| POST | `/work-items/:id/complete` | Employee (if assigned) | Marks atomic task completed → triggers point ledger credit (server-side, not client-computed). Requires the assignee to be currently clocked in (2026-07-18). **Tiered review (2026-08-08):** if `task_points` exceeds `WORK_ITEM_REVIEW_THRESHOLD` (default 3), the task moves to `in_review` instead and **no points are credited** — response is `{ workItem, pointsCredited: null, awaitingReview: true }`; below the threshold it is unchanged (`{ workItem, pointsCredited, awaitingReview: false }`). 409 if the task is already completed or already in review. **Self-logged tasks (2026-08-10) always go to `in_review`, whatever they are worth** — the threshold does not apply to them. |
| POST | `/work-items/:id/review` | Lead (own WorkUnit), Admin/HR | Added 2026-08-08. `{ action: "accept" \| "reject", points?, note? }`. `accept` sets the task `completed` and writes the point-ledger row (`points` defaults to `task_points`); `reject` returns it to `wip`. `note` is **required** to reject, and required to accept for fewer points than the task is worth. 409 unless the task is in `in_review`. Audited (`work_item.review_accept` / `work_item.review_reject`); notifies the assignee. **Sending `points` for a self-logged task is a 422 (2026-08-10)** — it is worth its type's points; accept it or send it back, but don't re-price it. |
| POST | `/work-items/self-log` | Employee **with a department** | Added 2026-08-10. `{ typeKey, title, description? }` — strict body, so a client-supplied `points` is rejected outright (422). The employee must be **currently clocked in** (422 if not); Admin/HR have no department and get 403 (checked *before* the clock-in test, since "not your feature" is a permanent answer and "clock in" is a transient one). Points are copied server-side from the `adhoc_task_types` row — the client never sends a number. Creates a `pending`, `selfLogged` atomic WorkItem due today, hung off the per-department auto-provisioned **"Ad-hoc Work" → "Self-logged Tasks"** container (created on first use, project lead = a department Lead, or the first active member if lead-less; 422 if the department has no active members). Audited (`work_item.self_log`). |
| GET | `/work-items/self-log` | Employee | Added 2026-08-10. The caller's own last 50 self-logged tasks with `{ status, taskPoints, awaitingReview, reviewNote, type }` — enough to show what is pending a Lead's confirmation without loading the work tree. |
| GET | `/adhoc-task-types` | Any authenticated user | Added 2026-08-10. The self-logged point catalog (`key`, `label`, `points`). Active-only; `?includeInactive=1` is honoured for Admin/HR only. |
| GET | `/work-items/review-queue` | Lead (own WorkUnits), Admin/HR (all) | Added 2026-08-08. Every task in `in_review` the caller can act on, oldest submission first, with assignee + project context. Self-scoping — returns `[]` rather than 403 for anyone who leads nothing. |
| GET | `/employees/:id/points` | Admin/HR, Lead (own team), Employee (self) | returns point ledger + running balance |
| GET | `/employees/:id/task-activity` | Admin/HR, Lead (own team), Employee (self) | Added 2026-07-23. `?period=daily\|weekly\|monthly\|total` (default `daily`), optional `?date=YYYY-MM-DD` anchor. Returns `{ summary: { period, from, to, tasksTouched, tasksCompletedInPeriod, pointsEarnedInPeriod, daysActiveInPeriod }, tasks: [{ workItemId, title, projectName, subUnitName, mode, status, taskPoints, assignedAt, completedAt, daysSelectedInPeriod, pointsEarnedInPeriod }] }` — every task the employee planned or completed in the period, enriched with which Project/SubUnit it belongs to. Distinct from `/employees/:id/work-items/history`, which is metric-mode growth tracking only. |

---

## 6. Payroll — **Track A**

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/payroll/config` | Admin/HR | the late-deduction percentage (2026-07-17 — half-day/unpaid-leave/absent are fixed fractions of a day's pay, not configured here) |
| PUT | `/payroll/config` | Admin | `{ late_deduction_percent, late_grace_minutes, effective_from }` — update the rate + late-grace window (versioned by `effective_from`) |
| GET | `/payslips/:employee_id/employee-of-month-status` | Admin/HR | Quick lookup: was this employee Employee of the Month for their department this period? (from `recognition_snapshots.is_employee_of_month`) — reference only. Superseded for the generate screen's own use by `POST /payslips/preview`, which returns the same flag alongside the full breakdown |
| POST | `/payslips/preview` | Admin/HR | Added 2026-07-17. `{ employee_id, month, year, incentive_amount?, bonus_amount?, other_addition_amount?, other_deduction_amount? }` — **read-only**, computes the same earned-pay breakdown + net pay as `/payslips/generate` (shared `lib/payroll/payslip-preview.ts`) without persisting anything, so the UI can show a live projection before the user commits |
| POST | `/payslips/generate` | Admin/HR | `{ employee_id, month, year, incentive_amount, bonus_amount, bonus_reason?, other_addition_amount?, other_addition_reason?, other_deduction_amount?, other_deduction_reason? }` — server computes `earned_base_pay` from **approved** attendance (present/half-day/paid-leave/holiday/compensation days paid; absent/unpaid-leave excluded) + a late-arrival penalty + reimbursements from approved requests, and denormalizes `employee_of_month_ref` |
| GET | `/payslips` | Admin/HR (all), Employee (self only, finalized only) | filters: `employee_id`, `month`, `year` |
| GET | `/payslips/:id` | Admin/HR (any), Employee (self only) | |
| PATCH | `/payslips/:id/finalize` | Admin/HR | draft → finalized |
| PATCH | `/payslips/:id/unfinalize` | **Admin only** | Added 2026-07-15 (manual override). finalized → draft; `{ reason }` required, audited. |
| DELETE | `/payslips/:id` | **Admin only** | Added 2026-07-15 (manual override). Drafts only (409 otherwise) — the unfinalize → delete → regenerate correction flow. Audited. |

---

## 7. Requests (generic — leave, reimbursement, WFH, etc.) — **Track B**

| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | `/requests` | Employee | `{ type, date_from?, date_to?, amount?, description?, attachment_url? }` |
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

## 10. Cross-cutting: Scheduled Jobs (not user-facing endpoints, but must exist)

These run via a lightweight cron mechanism (see Implementation Plan §6 — no LAN-dependent worker needed in v1):

- **On clock-out**: re-sum `total_hours`/`is_half_day` for the day's `attendance_records` row from its sessions (does not require approval first, but payroll only counts `approved` rows). While a session is open both are `null`/`false` — the day isn't finished.
- **Daily (EOD cleanup)**: `lib/cron/attendance-eod-cleanup.ts` deletes empty phantom records for past dates and closes any past day left with an **open session**, defaulting each unclosed session's clock-out from that session's own start (team expected start + 9h, else 20:00) and re-summing the day.
- **Nightly**: check `date_of_birth`/`date_of_joining` against today's date → populate `events/today` cache + push birthday/anniversary notifications.
- **Recurring, per-meeting**: at `scheduled_at − reminder_lead_minutes`, push a reminder notification to all invitees (individual + expanded team invitees) of each upcoming meeting.
- **Hourly (added 2026-08-10, Pillar 4)**: `lib/cron/crm-sync.ts` at `15 * * * *` (plus a boot-time run) pulls `GET https://crm.pikoruarealty.com/api/hrm/activity?from=&to=` with a Bearer `CRM_API_KEY`, upserts a 2-day lookback window into `sales_activity_sync`, writes through into each matched rep's `WorkItem`s, then re-provisions any missing sales targets. Unmatched rows are kept, flagged, and WARN-logged — never guessed onto a rep. ⚠️ The CRM is IP-allowlisted to the production VM, so a 401 from a dev machine is the allowlist, not a bad key.
- **Daily 00:10 UTC**: `lib/cron/metric-daily-rollover.ts` clones daily metric items forward and (since 2026-08-10) `repeatDaily` atomic items too, then provisions each active sales rep's daily/monthly targets.
- **Weekly**: compute `recognition_snapshots.score` from point ledger (Tech) / metric task performance (Sales/BD, scoped per department per the monthly target reset), and flag `is_employee_of_month` for each department's monthly top performer.
- **Monthly (changed 2026-08-08, Pillar 6)**: `score` is now a 0–100 weighted composite (output, quality, attendance, timeliness, commitments kept; see `lib/performance/composite.ts`), with the breakdown stored in `components`. Output is still points (Tech, normalised against the department's top scorer that period) or metric attainment (Sales/BD); the other four components are new. A `salesOutcome` slot exists at weight 0, reserved for CRM deal-outcome data once Pillars 4/5 land.
- **Monthly** (triggered manually by HR via `/payslips/generate`, not fully automatic in v1 per PRD): aggregate late/leave/half-day counts (from approved attendance only) for deduction calculation, and look up `is_employee_of_month` for reference display.
