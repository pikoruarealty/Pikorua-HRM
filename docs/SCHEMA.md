# Pikorua HRM — Database Schema (PostgreSQL)

> Companion to PRD.md and IMPLEMENTATION_PLAN.md. This is the authoritative schema reference — both dev tracks must treat changes here as requiring communication (see "Migration Ownership Rules" in the Implementation Plan) since many tables are shared across both feature tracks.

Notation: `PK` = primary key, `FK` = foreign key, `?` = nullable.

---

## 1. Core Identity & Org Structure (shared foundation — built in Phase 0)

### `users`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| email | text unique | |
| password_hash | text | |
| role | enum | `admin`, `hr`, `tech_lead`, `sales_lead`, `bde_lead`?, `tech_employee`, `sales_employee`, `bde` (confirm exact 7 roles from whiteboard, extendable) |
| employee_id | uuid FK → employees.id ? | null for pure system accounts if any |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### `departments`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | e.g. "Tech", "Sales", "B.D." |
| type_key | text | machine key, e.g. `tech`, `sales`, `bd` — used to look up label config |
| created_at | timestamptz | |

### `department_labels`
Config table implementing the generic label mapping described in PRD §4.1.
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| department_type_key | text | FK-ish to `departments.type_key` (not strict FK since new types can be added ahead of a department existing) |
| work_unit_label | text | e.g. "Project" / "Campaign" |
| sub_unit_label | text | e.g. "Feature" / "Target Segment" |
| work_item_label | text | e.g. "Task" / "Call" |
| work_item_mode | enum | `atomic` or `metric` — determines which progress model this department type uses by default |

### `teams`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| department_id | uuid FK → departments.id | |
| name | text | e.g. "Team 1" |
| team_lead_id | uuid FK → employees.id | |
| created_at | timestamptz | |

### `employees`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| full_name | text | |
| email | text unique | |
| phone | text? | |
| department_id | uuid FK → departments.id | |
| team_id | uuid FK → teams.id ? | |
| role | enum | mirrors users.role for the employee's functional role |
| date_of_birth | date? | used by Event Management |
| date_of_joining | date | used by Event Management (anniversary) and salary proration |
| base_salary | numeric(12,2) | editable |
| device_uid | integer? | reserved for the future biometric device-sync phase (not used in v1 manual attendance) |
| status | enum | `active`, `inactive` |
| created_at | timestamptz | |
| updated_at | timestamptz | |

---

## 2. Hierarchy / Project-Task Tracking (generic tree — PRD §4)

### `work_units` (Project / Campaign)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| department_id | uuid FK → departments.id | |
| name | text | |
| team_lead_id | uuid FK → employees.id | |
| status | enum | `active`, `completed`, `archived` |
| created_at | timestamptz | |
| deleted_at | timestamptz? | Soft delete (2026-07-18) — kept for audit (points ledger/recognition history reference `work_items` underneath). Deleting a WorkUnit cascades to its SubUnits and WorkItems (all soft-deleted together). Deleted rows are filtered out of every normal read. |

### `sub_units` (Feature / Target Segment)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| work_unit_id | uuid FK → work_units.id | |
| name | text | |
| created_at | timestamptz | |
| deleted_at | timestamptz? | Soft delete (2026-07-18) — cascades to its WorkItems. |

### `work_items` (Task / Call — supports both Atomic and Metric modes)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| sub_unit_id | uuid FK → sub_units.id | |
| assigned_to | uuid FK → employees.id | |
| title | text | |
| description | text? | Acceptance criteria / definition of done for this one item (2026-08-08). Plain text — deliberately not a separately-trackable checklist table. AI-proposed at generation, Lead-editable; read-only to the assignee. |
| due_date | date? | Target completion day (2026-08-08). AI proposes a date at generation (from a relative offset), the Lead confirms/edits it. Nullable — an item with no due date is simply undated, never overdue. |
| mode | enum | `atomic` or `metric` (inherited from department default, but stored per-item in case of override) |
| task_points | integer? | required if mode = atomic; assigned by Team Lead |
| target_value | numeric? | required if mode = metric, e.g. 100 (calls). **Editable at any time** (Team Lead can adjust mid-period). |
| current_value | numeric? | required if mode = metric, running count |
| frequency | enum? | required if mode = metric — `daily` or `monthly` (2026-07-18). Immutable after creation, like `mode`. |
| period_month | integer? | required if mode = metric |
| period_year | integer? | required if mode = metric |
| period_day | integer? | required if mode = metric && frequency = daily, else null |
| status | enum | `pending`, `wip`, `in_review`, `completed` — for atomic mode; for metric mode used loosely (`pending`/`wip`/`completed` when current >= target; metric items never enter `in_review`) |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| completed_at | timestamptz? | |
| submitted_at | timestamptz? | Tiered review (2026-08-08) — when the assignee handed a threshold-crossing task in. Survives a send-back, so a resubmitted task keeps its original hand-in time. |
| reviewed_by | uuid? FK → employees.id | The Lead who accepted or sent the task back. Null until reviewed. |
| reviewed_at | timestamptz? | When that verdict was given. Cleared on resubmission. |
| review_note | text? | The Lead's reason. Required to send a task back, or to credit fewer points than `task_points`. Cleared on resubmission. |
| deleted_at | timestamptz? | Soft delete (2026-07-18) — the points ledger keeps its row for audit even after the WorkItem is deleted; deleted rows are filtered out of every normal read. |

> **Tiered point crediting (2026-08-08):** atomic tasks worth **more than** `WORK_ITEM_REVIEW_THRESHOLD` (default 3) don't complete when the assignee marks them done — they move to `in_review` and wait for the WorkUnit's project lead (or Admin/HR) to accept via `POST /work-items/:id/review`. **`employee_point_ledger` is written only on acceptance**, so a task in review has earned nothing yet; the ledger's `unique(work_item_id)` constraint still guarantees at most one credit across all three crediting paths (`/complete`, `PATCH`, `/review`). Tasks at or below the threshold are unchanged — instant credit. See `lib/work/review.ts`.
>
> **Monthly reset implementation (resolved 2026-07-13):** a new metric `work_item` row is created each period rather than resetting `current_value` in place, so `recognition_snapshots` and `payslips.employee_of_month_ref` key off `period_month`/`period_year` (+ `period_day` for daily), never a single ever-growing `current_value`.
>
> **Daily frequency (2026-07-18):** a `daily`-frequency metric task always starts "today" (server computes `period_month`/`period_year`/`period_day` at creation, ignoring any client-supplied period) and rolls forward automatically — a cron job (`lib/cron/metric-daily-rollover.ts`, daily at 00:10 UTC) clones the latest non-deleted daily row per `(sub_unit_id, assigned_to)` forward to a fresh row for today (`current_value` reset to 0, `target_value` carried forward). Soft-deleting the latest row stops the chain. `monthly`-frequency tasks are unchanged — still a Lead manually creating the next month's row.

### `daily_task_selections`
Tracks which tasks an employee selected at clock-in for EOD point tallying.
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| employee_id | uuid FK → employees.id | |
| work_item_id | uuid FK → work_items.id | |
| date | date | |
| created_at | timestamptz | |

### `employee_point_ledger`
Append-only ledger crediting task points on completion (Atomic tasks only, Tech).
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| employee_id | uuid FK → employees.id | |
| work_item_id | uuid FK → work_items.id | |
| points | integer | |
| credited_at | timestamptz | |

---

## 3. Attendance

> **v1 = manual clock-in/clock-out + HR/Admin approval.** The biometric device LAN-sync integration (`device_punch_raw`, device UID mapping) is deferred — see the "Future phase" subsection below. Do not build the deferred tables/endpoints in v1, but the schema is structured so adding them later doesn't require reshaping `attendance_records`.

### `attendance_records`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| employee_id | uuid FK → employees.id | |
| date | date | |
| clock_in_raw | timestamptz? | as originally recorded by the employee's Clock In tap (server timestamp) |
| clock_out_raw | timestamptz? | as originally recorded by the employee's Clock Out tap |
| clock_in_approved | timestamptz? | HR/Admin-edited/approved value; falls back to `clock_in_raw` if unedited |
| clock_out_approved | timestamptz? | HR/Admin-edited/approved value; falls back to `clock_out_raw` if unedited |
| total_hours | numeric(4,2)? | derived from the approved times |
| is_half_day | boolean | derived: total_hours < 5 |
| approval_status | enum | `pending`, `approved` — payroll should only count `approved` records for a finalized payslip |
| approved_by | uuid FK → users.id ? | must be role admin/hr |
| approved_at | timestamptz? | |
| source | enum | `manual` (v1 default), `device_sync` (reserved for future phase), `manual_import` (reserved for future phase) |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### Future phase (on hold — not built in v1): `device_punch_raw`

Reserved for when the biometric device LAN-sync phase is revisited. Raw punches would be pulled from the device before being reconciled into `attendance_records`, keeping raw data separate so reconciliation logic can be re-run without re-polling the device. Columns (for reference, not to be created now): `device_uid`, `punch_time`, `direction`, `synced_at`, `dedup_key`. At that point, `employees.device_uid` (already present in the schema below) would be populated and `attendance_records.source` would start being set to `device_sync`.

---

## 4. Payroll

### `payroll_config`
Deduction config (Admin-editable). Since 2026-07-17, deductions are proportional to each
employee's own salary (`base_salary ÷ 30` = per-day rate) rather than flat company-wide rupee
amounts, so the only configurable rate left is the late-deduction percentage — half-day (50%),
unpaid-leave (100%), and absent (100%) are fixed fractions of the per-day rate, computed in
application code (`lib/payroll/calc.ts`), not stored here.
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | singleton row or versioned by effective date |
| late_deduction_percent | numeric(5,2) | % of one day's pay deducted per late occurrence, e.g. `20.00` = 20% |
| late_grace_minutes | int (default 0) | minutes after a team's expected start time within which a clock-in is still on time (not counted late); `0` = exact to the minute. Snapshotted per `effective_from` like the deduction rate. |
| effective_from | date | supports changing rates over time without breaking historical payslips |

### `payslips`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| employee_id | uuid FK → employees.id | |
| period_month | integer | |
| period_year | integer | |
| base_salary | numeric(12,2) | snapshot at generation time |
| incentive_amount | numeric(12,2) | manual entry |
| bonus_amount | numeric(12,2) | manual entry |
| bonus_reason | text? | |
| other_addition_amount | numeric(12,2)? | manual, ad-hoc one-off positive line item |
| other_addition_reason | text? | |
| other_deduction_amount | numeric(12,2)? | manual, ad-hoc one-off negative line item |
| other_deduction_reason | text? | |
| late_count | integer | auto-computed from **approved** attendance records only |
| unpaid_leave_count | integer | auto-computed (holiday/Sunday-aware, `lib/attendance/monthly-breakdown.ts`) — informational; excluded from earned_base_pay, not separately deducted |
| half_day_count | integer | auto-computed; contributes 0.5 day to earned_base_pay |
| absent_count | integer | auto-computed (added 2026-07-17) — days with no clock-in, no approved leave, no holiday; excluded from earned_base_pay, same treatment as unpaid leave. A Sunday clock-in never counts here (it's a compensation day instead) |
| present_count | integer | auto-computed (added 2026-07-17) — contributes 1 full day to earned_base_pay |
| paid_leave_count | integer | auto-computed (added 2026-07-17) — contributes 1 full day to earned_base_pay |
| holiday_count | integer | auto-computed (added 2026-07-17) — contributes 1 full day to earned_base_pay |
| compensation_count | integer | auto-computed (added 2026-07-17) — a Sunday clocked in; contributes 1 full day to earned_base_pay (no overtime premium) |
| earned_base_pay | numeric(12,2) | auto-computed (added 2026-07-17, renamed formula): `(present_count + half_day_count×0.5 + paid_leave_count + holiday_count + compensation_count) × (base_salary ÷ 30)` — what the employee actually earned for the period |
| late_deduction_total | numeric(12,2) | renamed from `standard_deduction_total` (2026-07-17) — now only the late-arrival penalty: `late_count × late_deduction_percent% × (base_salary ÷ 30)` |
| reimbursement_total | numeric(12,2) | sum of approved reimbursement requests for the period |
| employee_of_month_ref | boolean | denormalized flag: was this employee the Employee of the Month for their department this period? shown for reference only, does not affect calculation |
| net_pay | numeric(12,2) | computed: earned_base_pay + incentive + bonus + other_addition − late_deduction_total − other_deduction + reimbursement_total |
| generated_by | uuid FK → users.id | must be role admin/hr |
| generated_at | timestamptz | |
| status | enum | `draft`, `finalized` |

---

## 5. Requests (generic — PRD §5.9)

### `requests`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| employee_id | uuid FK → employees.id | requester |
| type | enum | `leave_paid`, `leave_unpaid`, `reimbursement`, `wfh`, `other` (extensible — consider a lookup table instead of hard enum if request types will grow often) |
| status | enum | `pending`, `approved`, `rejected` |
| date_from | date? | for leave/WFH |
| date_to | date? | for leave/WFH |
| amount | numeric(12,2)? | for reimbursement |
| description | text? | |
| attachment_url | text? | e.g. reimbursement receipt |
| approver_id | uuid FK → users.id ? | **must be role admin/hr** — leave and reimbursement requests are approved only by HR/Admin, never by Team Leads (enforce in application logic, not just convention) |
| approved_at | timestamptz? | |
| created_at | timestamptz | |

---

## 6. Recognition, Notifications, Documentation, Events, Assets

### `recognition_snapshots`
Weekly/Monthly aggregate leaderboard snapshots, computed **per department**.
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| period_type | enum | `weekly`, `monthly` |
| period_start | date | |
| department_id | uuid FK → departments.id | aggregation and ranking are scoped per department |
| employee_id | uuid FK → employees.id | |
| score | numeric | **`weekly`:** raw task points (Tech) or aggregated target performance (Sales/BD). **`monthly` (changed 2026-08-08, Pillar 6):** a 0–100 weighted composite — see `components` |
| components | jsonb NULL | Added 2026-08-08 (Pillar 6). The breakdown behind a monthly composite score: `{ score, components: [{ key, label, weight, nominalWeight, value, detail }], unavailable: [key] }`. `weight` is the **renormalised** share (always totals 100 across the listed components); `value` is that component's own 0–100 result. **Null on `weekly` rows and on rows computed before Pillar 6** — consumers must handle null and fall back to showing the bare score. Weights live in `lib/performance/composite.ts`: output 40, quality 20, attendance 20, timeliness 10, commitments-kept 10, plus a `salesOutcome` slot at **weight 0** reserved for CRM deal outcomes (Pillars 4/5, not built). A component with no data for the period is *unavailable*, not zero — it is dropped and the remaining weights are renormalised, so a first-month hire with no review yet is not penalised for it |
| rank | integer | rank within their department for that period |
| is_employee_of_month | boolean | true for `rank = 1` in a `monthly` snapshot for that department — this is what feeds `payslips.employee_of_month_ref` |

### `performance_reviews` (added 2026-08-08, overhaul Pillar 3)
The human counterweight to the automatic, countable signals. One 1–5 rating per employee per month per reviewer, entered by the Lead who owns their team (or Admin/HR). No employee-facing workflow: it is written on `/performance/review` and read back on the employee's own profile.
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| employee_id | uuid FK → employees.id | the person being reviewed; `ON DELETE CASCADE` |
| reviewer_id | uuid FK → employees.id | the Lead/Admin/HR who wrote it; `ON DELETE RESTRICT` |
| period_year | integer | |
| period_month | integer | 1–12 |
| rating | integer | 1–5; bounds + labels live in `lib/performance/review.ts` |
| note | text? | optional one-liner on what drove the rating |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**Unique** `(employee_id, reviewer_id, period_year, period_month)` — a repeat insert is a 409, so a rating is never silently overwritten; corrections go through `PATCH /performance-reviews/:id`. Two *different* reviewers may rate the same employee for the same month (the Lead's read and Admin's are separate rows). Feeds the **Quality** component of the Pillar 6 composite performance score.

### `notifications`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users.id | recipient |
| type | text | e.g. `leave_approved`, `task_assigned`, `birthday` |
| message | text | |
| read_at | timestamptz? | |
| created_at | timestamptz | |

### `announcements`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| title | text | |
| body | text | |
| scope_type | enum | `team` (creator's own team only), `all` (all-company), `specific_teams` |
| team_ids | uuid[]? | populated only when `scope_type = specific_teams`; a single value when `scope_type = team` (the creator's own team) |
| created_by | uuid FK → users.id | if role = `tech_lead`/`sales_lead`/etc., `scope_type` must be `team` and must match their own team (enforce in application logic); if role = admin/hr, `scope_type` may be `all` or `specific_teams` |
| created_at | timestamptz | |

### `events`
Covers both system-generated (birthday/anniversary) and manually-created (meeting) event types.
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| type | enum | `birthday`, `anniversary` (system-generated, derived from `employees.date_of_birth`/`date_of_joining` — may not need persistent rows, could be computed on the fly instead; see note below), `meeting` (manually created) |
| title | text? | for meetings, e.g. "Sprint Planning" |
| created_by | uuid FK → users.id ? | for meetings: must be role admin/hr/team_lead; null for system-generated birthday/anniversary events |
| scheduled_at | timestamptz? | meeting start time; null for birthday/anniversary |
| reminder_lead_minutes | integer? | for meetings — how long before `scheduled_at` to send the reminder notification, configurable per meeting |
| employee_id | uuid FK → employees.id ? | for birthday/anniversary events, whose birthday/anniversary it is; null for meetings |
| created_at | timestamptz | |

### `event_invitees`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| event_id | uuid FK → events.id | |
| employee_id | uuid FK → employees.id ? | individual invitee |
| team_id | uuid FK → teams.id ? | invite a whole team/group at once — expand to individual employee notifications at send-time |

> **Note on birthday/anniversary events:** these likely don't need persistent `events` rows at all — a nightly job can simply query `employees.date_of_birth`/`date_of_joining` for today's date and generate `notifications` directly. Only create `events` rows for these if you want a historical log of past birthday banners shown; otherwise this table is effectively meetings-only in practice, with birthday/anniversary handled as a lightweight derived query.

### `employee_documents`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| employee_id | uuid FK → employees.id | |
| doc_type | text | e.g. "ID Proof", "Offer Letter", "Contract" |
| file_url | text | S3/R2 object URL |
| uploaded_at | timestamptz | |

### `assets` (stub only — not built out in v1)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | |
| assigned_to | uuid FK → employees.id ? | |
| status | text? | placeholder |

---

## 7. Notes on Tree Queries

Both `work_units → sub_units → work_items` and `departments → teams` are shallow, fixed-depth trees (not arbitrary depth), so a plain adjacency structure with explicit FK columns (as above) is sufficient — no need for `ltree` or recursive CTEs for v1. Revisit only if the hierarchy grows deeper than 3-4 levels in practice.
