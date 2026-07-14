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

### 1.1 Departments ✅ done 2026-07-13
- [x] `GET /api/v1/departments` — Any authenticated role; returns departments joined with their `department_labels` config
- [x] `POST /api/v1/departments` — Admin only; `{ name, type_key }`
- [x] `GET /api/v1/departments/:type_key/labels` — Any role; returns `work_unit_label`/`sub_unit_label`/`work_item_label`/`work_item_mode`
- [x] `PUT /api/v1/departments/:type_key/labels` — Admin only; upserts the label config — this is how a new department's terminology gets configured without a code change (PRD §4.1)
- [x] Dashboard screen: Admin-only department list + label-config editor
- [x] New component folder `components/departments/` (Track A-owned, does not exist yet)

### 1.2 Teams ✅ done 2026-07-13
- [x] `GET /api/v1/teams` — Admin/HR (all), Lead/Employee (own department only — scope server-side)
- [x] `POST /api/v1/teams` — Admin/HR; `{ department_id, name, team_lead_id }`
- [x] `PATCH /api/v1/teams/:id` — Admin/HR; reassign lead, rename
- [x] Validation: `team_lead_id` must reference an employee whose `role` passes `isLeadRole()` (from shared `lib/rbac`, read-only use — no edit needed there)
- [x] Dashboard: team list/create/edit view
- [x] `DELETE /api/v1/teams/:id` — Admin/HR; **added 2026-07-13**, was not in the original API_SPEC.md scope, added on request. Hard-delete (Teams have no soft-delete/status field, unlike Employees). Blocks with `409 CONFLICT` if any employee is still assigned (`Employee.teamId` match) — reassign/remove members first; also catches any other FK reference (e.g. Track B's `event_invitees`) as a fallback `409`. Dashboard: Delete button next to Edit in `teams-screen.tsx`, with a confirm prompt.

### 1.3 Employees ✅ done 2026-07-13
- [x] `GET /api/v1/employees` — role-scoped: Admin/HR see all, Lead sees own team, Employee sees self only. Filters: `department_id`, `team_id`. **Server-side scoping is mandatory** — API_SPEC explicitly warns not to rely on frontend filtering
- [x] `GET /api/v1/employees/:id` — same scoping rule, Lead allowed if target employee is in their own team
- [x] `POST /api/v1/employees` — Admin/HR; creates employee + `base_salary` + department/team assignment
- [x] `PATCH /api/v1/employees/:id` — Admin/HR; editable fields: salary, department, team, status, `device_uid` mapping (field is reserved for the deferred biometric device-sync phase — just store the value, do not build anything that acts on it)
- [x] `DELETE /api/v1/employees/:id` — Admin only; soft-delete (`status → inactive`, never a hard delete)
- [x] Reactivate — **added 2026-07-14**, was a UI gap (the API already supported it via `PATCH .../status: "active"`, same FINANCE_ROLES gate as the rest of the edit form — not Admin-only like deactivate). "Reactivate employee" button on the detail page, shown when `status === "inactive"`.
- [x] Dashboard: employee list (searchable/filterable table), employee detail page, create/edit form
- [x] Employee detail attendance panel — **added 2026-07-14**: `components/attendance/employee-attendance-panel.tsx`, month picker, Present/Half-days/Late(approved)/Unpaid-leave stats pulled from the existing `GET /attendance` + `GET /attendance/:id/summary` endpoints, plus an explicitly-labeled "Absent (est.)" figure (working days so far this month, Mon–Sat, minus present minus unpaid leave — there's no holiday calendar in the schema, so this is a visible estimate, not a payroll figure). Visible to Admin/HR and to the employee viewing their own record; not specially extended to Lead-of-team since no other part of this page differentiates Leads either (the underlying API would 403 for anyone else, surfaced as the panel's error state).
- [x] `components/employees/` — table, form, detail card

**🟢 Open decision — resolved 2026-07-13 (asked Umang directly):**
Combined: `POST /employees` provisions the `User` row in the same call. Server generates a temporary password (returned once in the response) when the caller doesn't supply one; never stored in plaintext, only its bcrypt hash.

**Note:** building/testing these dashboard screens required two things not listed in either track's task breakdown — a login page and a dashboard shell/nav. Both landed as `app/(auth)/login`, `app/(dashboard)/layout.tsx`, `components/dashboard-nav.tsx`. Not on the CLAUDE.md shared-file list, but both tracks will touch `dashboard-nav.tsx` to add their own links — flag before restructuring it.

---

## Milestone 2 — Attendance ✅ done 2026-07-14

### 2.1 Employee-facing clock in/out
- [x] `POST /api/v1/attendance/clock-in` — server-timestamps `clock_in_raw`; creates today's row if absent, relying on the existing `@@unique([employeeId, date])` constraint. Open to **any authenticated user with a linked employee record**, not just `EMPLOYEE_ROLES` — attendance applies org-wide (Leads/Admin/HR are employees too), so the API_SPEC's "Employee" role shorthand was read as "the acting individual," not the RBAC employee-role group. Revisit if that reading turns out wrong.
- [x] `POST /api/v1/attendance/clock-out` — server-timestamps `clock_out_raw`
- [x] Compute `total_hours` + `is_half_day` inline at clock-out (`lib/attendance/time.ts` `computeHours()`), recomputed later from the *approved* times on edit/approve
- [x] Dashboard: Clock In / Clock Out widget (`components/attendance/attendance-screen.tsx`)

### 2.2 HR/Admin review & approval
- [x] `GET /api/v1/attendance` — Admin/HR (all, optional `employee_id` filter), Lead (own team only, server-enforced), Employee (self only); filters `date_from`, `date_to`, `approval_status`
- [x] `GET /api/v1/attendance/:employee_id/summary?month=&year=` — approved-only late/half-day/unpaid-leave counts (see below). Route folder is `[id]` not `[employee_id]` — Next.js requires one dynamic-segment name per path level and `.../[id]/edit` + `.../[id]/approve` use the attendance *record* id at that same level; the URL and semantics still match API_SPEC.md exactly, only the internal folder name differs.
- [x] `PATCH /api/v1/attendance/:id/edit` — Admin/HR; edits `clock_in_approved`/`clock_out_approved`, recomputes `total_hours`/`is_half_day` from the resulting effective (approved-or-raw) times. Raw values never overwritten.
- [x] `PATCH /api/v1/attendance/:id/approve` — Admin/HR; defaults approved times from raw if not separately edited, requires both a clock-in and clock-out to exist (422 otherwise), recomputes hours, sets `approval_status/approved_by/approved_at`
- [x] Dashboard: HR/Admin Attendance Review screen — status filter, inline edit form, approve button (`components/attendance/attendance-screen.tsx`)
- [x] `components/attendance/` — clock widget + review table + edit form in one screen component
- [x] `/attendance` nav link added to `components/dashboard-nav.tsx`

**🟢 Open decision — resolved 2026-07-14 (asked Umang directly):**
"Late" threshold is **team-wise**, not a global config: added `Team.expectedStartTime` ("HH:MM" 24h, nullable, Admin/HR-editable via the Teams screen — see Milestone 1 Teams UI). A team with no `expectedStartTime` set skips late-tracking for its members' records (summary response says so explicitly via `notes.late_tracking_unavailable`, never silently reports `0`). This is a `prisma/schema.prisma` edit — flagged in `CLAUDE.md`'s shared-file list; still needs a heads-up to Bhavarth before this branch merges, since Team is part of the shared-foundation section of SCHEMA.md even though Track A owns it.

**🟢 New cross-track contract — added 2026-07-14, not in the original Phase 0 agreement:**
The attendance summary also needs "unpaid leave days," which lives in Track B's `requests` table (`type=leave_unpaid`, `status=approved`), not in `attendance_records`. Added `getApprovedUnpaidLeaveDays(employeeId, month, year)` in `apps/web/lib/requests/leave.ts`, following the exact stub pattern of `getApprovedReimbursementTotal` — throws `NotImplementedError` until Track B implements it. The summary endpoint catches that specific error and returns `unpaid_leave_count: null` with a `notes.unpaid_leave_unavailable` explanation, rather than failing the whole endpoint or silently reporting `0`. **Flag this new contract to Bhavarth** — it wasn't agreed in the original Implementation Plan §5, which only named the reimbursement-total and Employee-of-Month helpers.

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
