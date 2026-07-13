# Track A — Implementation Task List (People, Time & Money)

> Companion to [PRD.md](./PRD.md), [SCHEMA.md](./SCHEMA.md), [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md), [API_SPEC.md](./API_SPEC.md). Scope = **Track A only** (owner: Umang) — Employees, Departments/Teams/Hierarchy config, Attendance, Payroll/Payslips. Keep this in sync with [progress.md](../progress.md) as items complete; that file is the canonical status tracker, this file is the detailed breakdown behind it.
>
> **Last updated:** 2026-07-13

---

## ⚠️ Shared-file warning — read before starting any task below

These files are common ground with Track B (Bhavarth). **Stop and flag Umang/Bhavarth before editing any of them** — do not touch as a side effect of a Track A task.

| File / area | Why it's shared | When Track A would legitimately need to touch it |
|---|---|---|
| `prisma/schema.prisma` | Single shared migration file; both tracks' models live here | Only if `Employee`, `User`, `Department`, or `Team` need a field change (Track A owns these per SCHEMA.md §1, but Migration Ownership Rules still require a heads-up before merge), or if `PayrollConfig`/`Payslip`/`AttendanceRecord` need a new field (Track A's own tables, but still a shared-file edit — flag it anyway since it's a migration) |
| `apps/web/lib/rbac/index.ts` | Role guards used by every route in both tracks | Only if a role needs adding (e.g. `bde_lead` gets confirmed per PRD §7 open questions) |
| `apps/web/lib/auth/*` | Shared session/login/password hashing | Not expected to change for Track A work |
| `apps/web/lib/api/response.ts`, `apps/web/lib/errors.ts` | Shared `{ data, error }` envelope + error types | Not expected to change |
| `apps/web/components/ui/*` (shadcn primitives) | Shared design system both tracks build on | Only additive — if a needed primitive (date-picker, dialog, tabs, etc.) doesn't exist yet, add it as a new file; never restyle or change the API of an existing primitive without asking |
| `apps/web/lib/requests/reimbursements.ts` | Cross-track contract — **owned/implemented by Track B**, Track A only calls it | Never edit the implementation; only ever `import { getApprovedReimbursementTotal }` and call it with its existing signature |
| `apps/web/lib/recognition/employee-of-month.ts` | Cross-track contract — **owned/implemented by Track B**, Track A only calls it | Never edit the implementation; only ever `import { getEmployeeOfMonthStatus }` and call it with its existing signature |
| `prisma/seed.ts` | Shared seed data (both tracks depend on it for local dev) | Only additive (e.g. more sample attendance/payroll rows for testing) — flag before restructuring existing seed users/departments/teams |

---

## Phase 0 — Verification (blocking, do first)

Per `progress.md`, Phase 0's code is mostly written but unverified against a real DB. Nothing else below should start until this is green.

- [ ] Provision/connect a reachable Postgres `DATABASE_URL`
- [ ] Run `bun run prisma:migrate` — first real migration against the full schema
- [ ] Run `bun run db:seed` — confirm seed succeeds against the migrated DB
- [ ] Confirm `POST /api/v1/auth/login` works end-to-end for a seeded user
- [ ] Run `bun run build` — confirm the whole scaffold compiles clean
- [ ] Update `progress.md` Phase 0 table once all of the above are actually green (not before — never mark something built/verified without having run it, per CLAUDE.md standing rule 2)

---

## Milestone 1 — Org Structure Foundations

### 1.1 Departments
- [ ] `GET /api/v1/departments` — Any authenticated role; returns departments joined with their `department_labels` config
- [ ] `POST /api/v1/departments` — Admin only; `{ name, type_key }`
- [ ] `GET /api/v1/departments/:type_key/labels` — Any role; returns `work_unit_label`/`sub_unit_label`/`work_item_label`/`work_item_mode`
- [ ] `PUT /api/v1/departments/:type_key/labels` — Admin only; upserts the label config — this is how a new department's terminology gets configured without a code change (PRD §4.1)
- [ ] Dashboard screen: Admin-only department list + label-config editor
- [ ] New component folder `components/departments/` (Track A-owned, does not exist yet)

### 1.2 Teams
- [ ] `GET /api/v1/teams` — Admin/HR (all), Lead/Employee (own department only — scope server-side)
- [ ] `POST /api/v1/teams` — Admin/HR; `{ department_id, name, team_lead_id }`
- [ ] `PATCH /api/v1/teams/:id` — Admin/HR; reassign lead, rename
- [ ] Validation: `team_lead_id` must reference an employee whose `role` passes `isLeadRole()` (from shared `lib/rbac`, read-only use — no edit needed there)
- [ ] Dashboard: team list/create/edit view

### 1.3 Employees
- [ ] `GET /api/v1/employees` — role-scoped: Admin/HR see all, Lead sees own team, Employee sees self only. Filters: `department_id`, `team_id`. **Server-side scoping is mandatory** — API_SPEC explicitly warns not to rely on frontend filtering
- [ ] `GET /api/v1/employees/:id` — same scoping rule, Lead allowed if target employee is in their own team
- [ ] `POST /api/v1/employees` — Admin/HR; creates employee + `base_salary` + department/team assignment
- [ ] `PATCH /api/v1/employees/:id` — Admin/HR; editable fields: salary, department, team, status, `device_uid` mapping (field is reserved for the deferred biometric device-sync phase — just store the value, do not build anything that acts on it)
- [ ] `DELETE /api/v1/employees/:id` — Admin only; soft-delete (`status → inactive`, never a hard delete)
- [ ] Dashboard: employee list (searchable/filterable table), employee detail page, create/edit form
- [ ] `components/employees/` — table, form, detail card

**🟡 Open decision — resolve before/at start of this task, not silently assumed:**
Employee creation implies a linked login (`User.employeeId` in schema). Two options:
1. `POST /employees` also provisions the `User` row (email + generated/temp password) in the same call.
2. Employee record and login account are two separate creation steps (Admin creates employee first, then separately provisions a login).

This changes the `POST /employees` request/response contract, so it should be settled before writing that endpoint.

---

## Milestone 2 — Attendance

### 2.1 Employee-facing clock in/out
- [ ] `POST /api/v1/attendance/clock-in` — Employee role; server-timestamps `clock_in_raw`; creates today's row if absent. Schema already has a `@@unique([employeeId, date])` constraint on `attendance_records`, which prevents duplicate rows for the same day — rely on that rather than re-implementing the check.
- [ ] `POST /api/v1/attendance/clock-out` — Employee role; server-timestamps `clock_out_raw` on today's row
- [ ] Compute `total_hours` + `is_half_day` (< 5 hrs total) inline in the clock-out handler once both timestamps exist (per Implementation Plan §7 — no separate cron/job needed for this specific computation)
- [ ] Dashboard: Clock In / Clock Out widget on the employee's own dashboard home

### 2.2 HR/Admin review & approval
- [ ] `GET /api/v1/attendance` — Admin/HR (all), Lead (own team), Employee (self); filters `employee_id`, `date_from`, `date_to`, `approval_status`
- [ ] `GET /api/v1/attendance/:employee_id/summary` — monthly summary (late count, half-days, unpaid leave days), computed from **approved-only** records — this is the exact feed payroll (Milestone 3) will call
- [ ] `PATCH /api/v1/attendance/:id/edit` — Admin/HR; edits `clock_in_approved`/`clock_out_approved`, defaulting from the raw values if not otherwise set. Raw values are preserved in separate columns (`clock_in_raw`/`clock_out_raw`) for audit — never overwrite them.
- [ ] `PATCH /api/v1/attendance/:id/approve` — Admin/HR; sets `approval_status = approved`, `approved_by`, `approved_at`
- [ ] Dashboard: HR/Admin Attendance Review screen — table of pending/approved records, inline edit, approve action
- [ ] `components/attendance/` — clock widget, review table, edit dialog

**🟡 Open decision — blocks part of Milestone 3, resolve here:**
"Late" is not a stored field anywhere in the schema — it must be derived at payroll time by comparing `clock_in_approved` against an expected office start time. No such expected-start-time config currently exists in `PayrollConfig` or elsewhere. This needs a decision (e.g., add an `expectedStartTime` field to `PayrollConfig`) before the payroll deduction logic in Milestone 3 can compute `late_count`. Since `PayrollConfig` lives in the shared `prisma/schema.prisma`, adding a field there is still a schema migration and should be flagged per the shared-file rule above, even though the table itself is Track A's own.

---

## Milestone 3 — Payroll

- [ ] `GET /api/v1/payroll/config` — Admin/HR; current flat deduction rates
- [ ] `PUT /api/v1/payroll/config` — Admin only; update flat rates, versioned by `effective_from` (never overwrite a historical rate row — insert a new one so past payslips remain reproducible)
- [ ] `GET /api/v1/payslips/:employee_id/employee-of-month-status` — Admin/HR; calls Track B's `getEmployeeOfMonthStatus(employeeId, month, year)` stub — **reference-only display**, does not affect any calculation
- [ ] `POST /api/v1/payslips/generate` — Admin/HR; `{ employee_id, month, year, incentive_amount, bonus_amount, bonus_reason?, other_addition_amount?, other_addition_reason?, other_deduction_amount?, other_deduction_reason? }`. Server-side, this must:
  - Pull `late_count`/`unpaid_leave_count`/`half_day_count` from **approved-only** attendance (via the Milestone 2.2 summary logic)
  - Compute `standard_deduction_total` from those counts × current `payroll_config` flat rates
  - Call Track B's `getApprovedReimbursementTotal(employeeId, month, year)` for `reimbursement_total`
  - Call `getEmployeeOfMonthStatus(...)` to set `employee_of_month_ref` (denormalized, informational only)
  - Compute `net_pay = base + incentive + bonus + other_addition − standard_deduction_total − other_deduction + reimbursement_total`
- [ ] `GET /api/v1/payslips` — Admin/HR (all), Employee (self only, **finalized only** — drafts must never be visible to the employee)
- [ ] `GET /api/v1/payslips/:id` — Admin/HR (any), Employee (self only)
- [ ] `PATCH /api/v1/payslips/:id/finalize` — Admin/HR; `draft → finalized`
- [ ] Dashboard: payroll config screen; payslip generation form (manual incentive/bonus/other-addition/other-deduction inputs + read-only auto-computed deduction/reimbursement breakdown + Employee-of-Month reference badge); payslip list/detail view; employee's own finalized-payslip view
- [ ] `components/payroll/` — config form, payslip generation form, payslip detail/list views

**Note on cross-track dependency:** until Track B implements the real logic behind `getApprovedReimbursementTotal` and `getEmployeeOfMonthStatus`, calling them will throw `NotImplementedError` in dev (see the stub files' current behavior) — that is expected and is **not a Track A bug**. Do not work around it by inlining a query against `requests`/`recognition_snapshots` directly; that would violate the agreed cross-track contract and the "never touch Track B's implementation" rule above.

---

## Milestone 4 — Integration & Polish

- [ ] Cross-test payroll ↔ reimbursements and payroll ↔ employee-of-month once Track B's real implementations land (replace the stub throws)
- [ ] Full RBAC pass across all Track A screens/endpoints — verify Employee/Lead/HR/Admin visibility boundaries match PRD §3 exactly, especially that salary/incentive/bonus/reimbursement data stays Admin/HR-only everywhere (the "golden rule")
- [ ] Update `progress.md` Track A table as each milestone above completes — don't batch updates, keep it live

---

## Operating discipline while working through this list

Per CLAUDE.md standing rules, applied to every item above:
1. **Cascading, complete updates** — a change to a shared piece (e.g. adding a `PayrollConfig` field, editing the employee scoping logic) must be propagated through every dependent layer (schema → helper → API → UI → seed) before considering the task done. No partial edits left for "later."
2. **Never bluff** — a checkbox above only gets marked done once it's actually been run/tested, not once code has been written. State unknowns (like the two 🟡 open decisions) explicitly rather than assuming an answer.
