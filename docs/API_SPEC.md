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
| POST | `/auth/login` | Public | `{ email, password }` → session + user profile (id, role, employee_id) |
| POST | `/auth/logout` | Any | |
| GET | `/auth/me` | Any | returns current user + role + employee profile summary |

---

## 2. Employees & Org Structure — **Track A**

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/employees` | Admin/HR (all), Lead (own team only), Employee (self only) | Query filters: `department_id`, `team_id`. Response scoped server-side by role — do not rely on frontend filtering. |
| GET | `/employees/:id` | Admin/HR (any), Lead (if in own team), Employee (self only) | |
| POST | `/employees` | Admin/HR | Creates employee + base_salary + department/team assignment |
| PATCH | `/employees/:id` | Admin/HR | Editable: salary, department, team, status, device_uid mapping |
| DELETE | `/employees/:id` | Admin | Soft-delete (status → inactive) |
| GET | `/departments` | Any | Returns departments + their `department_labels` config |
| POST | `/departments` | Admin | `{ name, type_key }` |
| GET | `/departments/:type_key/labels` | Any | Returns work_unit/sub_unit/work_item label mapping for that department type |
| PUT | `/departments/:type_key/labels` | Admin | Update label config — this is how a new department's terminology is configured |
| GET | `/teams` | Admin/HR (all), Lead/Employee (own department) | |
| POST | `/teams` | Admin/HR | `{ department_id, name, team_lead_id }` |
| PATCH | `/teams/:id` | Admin/HR | reassign lead, rename |

---

## 3. Attendance — **Track A**

> **v1 = manual clock-in/clock-out + HR/Admin approval.** The biometric device LAN-sync worker and its internal endpoint are **deferred, not built in v1** — see PRD §5.1.1 and Implementation Plan for the future-phase design (kept for context continuity only).

| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | `/attendance/clock-in` | Employee | Server-timestamped; creates/updates today's `attendance_records` row for the current employee with `clock_in_raw` |
| POST | `/attendance/clock-out` | Employee | Server-timestamped; sets `clock_out_raw` on today's row |
| GET | `/attendance` | Admin/HR (all), Lead (own team), Employee (self) | filters: `employee_id`, `date_from`, `date_to`, `approval_status` |
| GET | `/attendance/:employee_id/summary` | Admin/HR, Lead (own team), Employee (self) | monthly summary: total late count, half-days, unpaid leave days — computed from **approved** records only, feeds payroll |
| PATCH | `/attendance/:id/edit` | Admin/HR | Edits `clock_in_approved`/`clock_out_approved` (e.g., correcting a forgotten clock-out) |
| PATCH | `/attendance/:id/approve` | Admin/HR | Sets `approval_status = approved`, `approved_by`, `approved_at`. If not separately edited first, approved times default to the raw values. |

---

## 4. Project / Task Tracking (WorkUnit → SubUnit → WorkItem) — **Track B**

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/work-units` | Admin/HR (all), Lead (own department), Employee (assigned or own department, status-only view) | filters: `department_id` |
| POST | `/work-units` | Lead, Admin/HR | Creates a Project/Campaign; `team_lead_id` defaults to creator if Lead |
| GET | `/work-units/:id` | Any (scoped) | nested response includes sub_units + work_items |
| PATCH | `/work-units/:id` | Lead (own), Admin/HR | status changes, rename |
| POST | `/work-units/:id/sub-units` | Lead (own work_unit), Admin/HR | `{ name }` |
| POST | `/sub-units/:id/work-items` | Lead (own), Admin/HR | `{ title, assigned_to, mode, task_points? , target_value? }` — Lead sets task_points for atomic mode |
| PATCH | `/work-items/:id` | Assigned Employee (status/current_value only), Lead (all fields) | Employees update their own task's status (atomic) or current_value (metric); Leads can reassign/edit points |
| GET | `/work-items/mine` | Employee | tasks assigned to the current employee, across work units |

---

## 5. Daily Planning / EOD — **Track B**

| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | `/daily-selections` | Employee | Called at clock-in: `{ work_item_ids: [] }` for today |
| GET | `/daily-selections/today` | Employee, Lead (own team) | |
| POST | `/work-items/:id/complete` | Employee (if assigned) | Marks atomic task completed → triggers point ledger credit (server-side, not client-computed) |
| GET | `/employees/:id/points` | Admin/HR, Lead (own team), Employee (self) | returns point ledger + running balance |

---

## 6. Payroll — **Track A**

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/payroll/config` | Admin/HR | flat deduction rates |
| PUT | `/payroll/config` | Admin | update flat rates (versioned by `effective_from`) |
| GET | `/payslips/:employee_id/employee-of-month-status` | Admin/HR | Quick lookup used by the payslip generation screen: was this employee Employee of the Month for their department this period? (from `recognition_snapshots.is_employee_of_month`) — reference only |
| POST | `/payslips/generate` | Admin/HR | `{ employee_id, month, year, incentive_amount, bonus_amount, bonus_reason?, other_addition_amount?, other_addition_reason?, other_deduction_amount?, other_deduction_reason? }` — server auto-computes standard deductions from **approved** attendance + reimbursements from approved requests, and denormalizes `employee_of_month_ref` |
| GET | `/payslips` | Admin/HR (all), Employee (self only, finalized only) | filters: `employee_id`, `month`, `year` |
| GET | `/payslips/:id` | Admin/HR (any), Employee (self only) | |
| PATCH | `/payslips/:id/finalize` | Admin/HR | draft → finalized |

---

## 7. Requests (generic — leave, reimbursement, WFH, etc.) — **Track B**

| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | `/requests` | Employee | `{ type, date_from?, date_to?, amount?, description?, attachment_url? }` |
| GET | `/requests` | Admin/HR (all), Lead (own team), Employee (self) | filters: `type`, `status`, `employee_id` |
| GET | `/requests/:id` | scoped as above | |
| PATCH | `/requests/:id/approve` | **Admin/HR only** (all request types, including leave and reimbursement — Team Leads cannot approve) | sets status + approver_id + approved_at |
| PATCH | `/requests/:id/reject` | **Admin/HR only** | same as approve |

---

## 8. Recognition, Notifications, Announcements, Documentation, Events — **Track B**

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/recognition` | Any | filters: `period_type` (weekly/monthly), `department_id` — leaderboard view, includes `is_employee_of_month` flag |
| GET | `/notifications` | Any (self) | current user's notifications |
| PATCH | `/notifications/:id/read` | Any (self) | |
| GET | `/announcements` | Any | server scopes results: all-company + specific-team announcements matching the user's team + team announcements for the user's own team |
| POST | `/announcements` | Lead (own team only — `scope_type` forced to `team`), Admin/HR (`scope_type` = `all` or `specific_teams`) | `{ title, body, scope_type, team_ids? }` |
| GET | `/employees/:id/documents` | Admin/HR (any), Employee (self) | |
| POST | `/employees/:id/documents` | Admin/HR | upload at hiring time or later |
| GET | `/events/today` | Any | returns today's birthdays/anniversaries (derived query, see Schema doc) for the login banner |
| POST | `/events/meetings` | Admin, HR, Lead | `{ title, scheduled_at, reminder_lead_minutes, invitee_employee_ids?, invitee_team_ids? }` |
| GET | `/events/meetings` | Any (scoped to meetings the user is invited to, directly or via their team) | |
| PATCH | `/events/meetings/:id` | Creator, Admin/HR | reschedule, edit invitees, edit reminder lead time |
| DELETE | `/events/meetings/:id` | Creator, Admin/HR | |

---

## 9. Assets (stub) — **Track B (low priority)**

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/assets` | Admin/HR | placeholder, not built out in v1 |

---

## 10. Cross-cutting: Scheduled Jobs (not user-facing endpoints, but must exist)

These run via a lightweight cron mechanism (see Implementation Plan §6 — no LAN-dependent worker needed in v1):

- **On clock-in/out**: compute `total_hours`/`is_half_day` for the day's `attendance_records` row once both times exist (does not require approval first, but payroll only counts `approved` rows).
- **Nightly**: check `date_of_birth`/`date_of_joining` against today's date → populate `events/today` cache + push birthday/anniversary notifications.
- **Recurring, per-meeting**: at `scheduled_at − reminder_lead_minutes`, push a reminder notification to all invitees (individual + expanded team invitees) of each upcoming meeting.
- **Weekly/Monthly**: compute `recognition_snapshots` from point ledger (Tech) / metric task performance (Sales/BD, scoped per department per the monthly target reset), and flag `is_employee_of_month` for each department's monthly top performer.
- **Monthly** (triggered manually by HR via `/payslips/generate`, not fully automatic in v1 per PRD): aggregate late/leave/half-day counts (from approved attendance only) for deduction calculation, and look up `is_employee_of_month` for reference display.
