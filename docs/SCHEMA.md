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

### `sub_units` (Feature / Target Segment)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| work_unit_id | uuid FK → work_units.id | |
| name | text | |
| created_at | timestamptz | |

### `work_items` (Task / Call — supports both Atomic and Metric modes)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| sub_unit_id | uuid FK → sub_units.id | |
| assigned_to | uuid FK → employees.id | |
| title | text | |
| mode | enum | `atomic` or `metric` (inherited from department default, but stored per-item in case of override) |
| task_points | integer? | required if mode = atomic; assigned by Team Lead |
| target_value | numeric? | required if mode = metric, e.g. 100 (calls). **Editable at any time** (Team Lead can adjust mid-period). |
| current_value | numeric? | required if mode = metric, running count |
| period_month | integer? | required if mode = metric — **Sales/BD targets reset every month**, so each month is tracked as its own period rather than one indefinitely-running target |
| period_year | integer? | required if mode = metric |
| status | enum | `pending`, `wip`, `completed` — for atomic mode; for metric mode used loosely (`pending`/`wip`/`completed` when current >= target) |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| completed_at | timestamptz? | |

> **Monthly reset implementation note (Track B to decide):** either (a) a new metric `work_item` row is created each month for each employee/target, or (b) a single recurring target record has `current_value` reset to 0 at the start of each month while `period_month`/`period_year` advance. Either is fine — pick whichever is simpler given the ORM, but the `recognition_snapshots` and `payslips.employee_of_month_ref` logic should key off `period_month`/`period_year`, not assume a single ever-growing `current_value`.

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
| score | numeric | task points (Tech) or aggregated target performance (Sales/BD) |
| rank | integer | rank within their department for that period |
| is_employee_of_month | boolean | true for `rank = 1` in a `monthly` snapshot for that department — this is what feeds `payslips.employee_of_month_ref` |

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
