# Pikorua HRM — Implementation Plan

> Companion to PRD.md, SCHEMA.md, and API_SPEC.md. Read all three before this document. This plan covers architecture, repo structure, and — most importantly — how work is split between the 2 developers **by feature/vertical slice, not by frontend/backend**, to avoid merge conflicts and integration hell.

---

## 1. Tech Stack (decided)

- **Framework:** Next.js (App Router), TypeScript throughout.
- **Database:** PostgreSQL.
- **ORM:** Prisma (recommended — schema-first, generates types, migration tooling built in; fits a 2-dev team well since migrations are file-based and reviewable in PRs).
- **Auth:** NextAuth.js (or a lightweight custom JWT/session setup) with role claims matching the 7 roles in PRD §3.
- **File storage:** S3-compatible (AWS S3 or Cloudflare R2) for employee documents and reimbursement attachments.
- **Scheduled jobs (v1 — lightweight, no standalone worker needed):** since the biometric device LAN-sync integration is **on hold** (see PRD §5.1.1), v1 does **not** need a separate standalone background service with LAN/VPN access. Scheduled jobs (nightly birthday/anniversary check, per-meeting reminder sends, weekly/monthly recognition snapshot computation) can run as simple cron-triggered API routes or a scheduled function on your hosting platform (e.g., Vercel Cron, or a basic `node-cron` process alongside the app).
  - **Future phase (not v1):** when the device LAN-sync is revisited, it will need a **separate standalone service** on a machine with LAN/VPN access to the biometric device, polling port 4370 — see PRD §5.1.1 for details. Keep this in mind architecturally (i.e., don't build anything that assumes attendance can only ever be entered manually), but do not build the worker itself now.
- **Hosting:** Main Next.js app on standard cloud hosting (Vercel, Render, or a VPS) — no on-premise machine required for v1 since there's no LAN-dependent worker yet.
- **Styling/UI:** Tailwind CSS + a component library (shadcn/ui recommended) for consistent, fast UI building across both devs.

---

## 2. Repo Structure

```
pikorua-hrm/
├── apps/
│   ├── web/                     # Next.js app (App Router)
│   │   ├── app/
│   │   │   ├── (auth)/
│   │   │   ├── (dashboard)/
│   │   │   │   ├── employees/           # Track A
│   │   │   │   ├── attendance/          # Track A
│   │   │   │   ├── payroll/             # Track A
│   │   │   │   ├── work-units/          # Track B
│   │   │   │   ├── requests/            # Track B
│   │   │   │   ├── recognition/         # Track B
│   │   │   │   └── announcements/       # Track B
│   │   │   └── api/
│   │   │       └── v1/
│   │   │           ├── employees/       # Track A
│   │   │           ├── attendance/      # Track A
│   │   │           ├── payroll/         # Track A
│   │   │           ├── work-units/      # Track B
│   │   │           ├── requests/        # Track B
│   │   │           └── ...
│   │   ├── lib/
│   │   │   ├── auth/                    # SHARED — Phase 0
│   │   │   ├── rbac/                    # SHARED — Phase 0
│   │   │   └── db/                      # SHARED — Prisma client, Phase 0
│   │   └── components/
│   │       ├── ui/                      # SHARED shadcn primitives — Phase 0, rarely touched after
│   │       ├── employees/               # Track A
│   │       ├── attendance/              # Track A
│   │       ├── payroll/                 # Track A
│   │       ├── work-units/              # Track B
│   │       └── requests/                # Track B
│   └── (attendance-worker/)     # NOT built in v1 — reserved path for the future device-sync phase (PRD §5.1.1); scheduled jobs for v1 live inside apps/web instead (e.g. app/api/v1/cron/)
├── prisma/
│   └── schema.prisma             # SHARED FILE — see migration ownership rules below
└── docs/
    ├── PRD.md
    ├── SCHEMA.md
    ├── API_SPEC.md
    └── IMPLEMENTATION_PLAN.md
```

**Key principle:** folders are already split by feature under `app/(dashboard)/`, `app/api/v1/`, and `components/`, so each dev works in their own subtree almost all the time. Merge conflicts mainly become a risk in **shared files** — handled explicitly below.

---

## 3. Feature-Based Split Between the 2 Developers

Rather than "frontend dev" / "backend dev," each developer owns a **vertical slice**: full-stack (DB → API → UI) for their assigned modules. This means each dev can build and test end-to-end without waiting on the other.

### Track A — "People, Time & Money" (suggested owner: **Umang** — assign as your team prefers)
Owns: Employees, Departments/Teams/Hierarchy config, Attendance (manual clock-in/out + HR/Admin approval), Payroll/Payslips.

- Employee CRUD + department/team management
- `department_labels` config UI (Admin screen to configure generic tree labels per department type)
- Manual Clock In / Clock Out flow + HR/Admin attendance approval & edit screen
- Payroll config (flat deduction rates), payslip generation flow (Incentive/Bonus/Other Addition/Other Deduction manual fields + auto-computed standard deductions from approved attendance + reimbursement pull-in), Employee-of-the-Month reference lookup on the payslip screen

### Track B — "Work, Requests & Culture" (suggested owner: **Bhavarth** — assign as your team prefers)
Owns: WorkUnit/SubUnit/WorkItem (project/task tracking), Daily Planning/EOD flow, Requests (leave/reimbursement/etc.), Recognition & Employee of the Month, Notifications, Announcements, Employee Documentation, Event Management (birthdays + meetings), Assets (stub).

- WorkUnit/SubUnit/WorkItem CRUD, Atomic vs Metric task logic (Sales/BD metric targets reset monthly, editable anytime)
- Daily task selection + EOD completion + point ledger crediting
- Generic Requests module (leave, reimbursement, WFH, etc.) + **HR/Admin-only approval flow** (no Team Lead approval)
- Recognition leaderboard computation (per department) + Employee of the Month flagging
- Notifications infrastructure (generic push service any module can call)
- Announcements with scoping: Team Lead → own team only; HR/Admin → all-company or specific teams
- Employee document upload/storage
- Event Management: birthday/anniversary login banner (derived query) + Meetings (creatable by Admin/HR/Lead, with invitees and configurable reminder lead time)
- Assets stub

> Names above are a suggestion based on typical split of "data/finance-heavy" vs. "workflow/collaboration-heavy" work — swap freely based on actual preference/strengths between Umang and Bhavarth.

### Why this split (not frontend/backend)

- Both tracks touch DB, API routes, and UI — but **different tables and different route folders**, so the two devs are almost never editing the same file.
- Track A's work is inherently more "data plumbing + external integration" (device sync, payroll math). Track B's work is more "workflow + collaboration features." This maps reasonably evenly in complexity.
- The one dependency between tracks: **Payroll (Track A) reads approved Reimbursement Requests (Track B)** and **Payroll reads Attendance (Track A, no cross-track dependency there)**. This is the only real inter-track coupling — see §5.

---

## 4. Phase 0 — Shared Foundation (both devs together, ~2-4 days before splitting)

Do this together, in the same session/pairing if possible, to avoid the shared files becoming a conflict source later:

1. Set up Next.js project, TypeScript config, Tailwind, shadcn/ui.
2. Set up Prisma + Postgres connection, write the **initial schema migration** covering ALL tables from SCHEMA.md (even though each track will only actively use their own tables at first) — this avoids both devs racing to add tables to `schema.prisma` independently later.
3. Build `lib/auth/` (login, session/JWT handling) and `lib/rbac/` (role-checking helper functions, e.g. `requireRole(session, ['admin','hr'])`) — used by every API route in both tracks.
4. Seed script: create one Admin user, one HR user, one of each Lead/Employee role, 3 departments (Tech/Sales/BD) with their `department_labels` pre-configured, so both devs have data to build against immediately.
5. Agree on the shared `components/ui/` primitives (buttons, cards, tables, forms) so both tracks' screens look consistent without duplicating style decisions later.

**After Phase 0, both devs work independently in their tracks, using the folder split in §2.**

---

## 5. Cross-Track Dependencies: Payroll ↔ Reimbursements & Recognition

Track A's payslip generation needs two things that live in Track B's tables:

1. **Approved reimbursement totals** (`requests` table, `type = reimbursement`, `status = approved`).
2. **Employee of the Month reference** (`recognition_snapshots.is_employee_of_month` for the relevant department/month), shown for informational reference on the payslip generation screen (does not affect the calculation, just displayed to help HR/Admin decide the Incentive/Bonus amount).

**Resolution:** Track B exposes two small, stable internal query helpers early — e.g. `getApprovedReimbursementTotal(employeeId, month, year)` and `getEmployeeOfMonthStatus(employeeId, month, year)` in a shared `lib/requests/` and `lib/recognition/` module respectively — that Track A can import and call from the payroll generation logic. Agree on both function **signatures** during Phase 0 or as soon as the underlying tables exist, even before the full Requests/Recognition UI is built, so Track A isn't blocked waiting on Track B's full feature.

No other module has this kind of hard dependency — everything else in Track B (WorkUnit/Task tracking, Notifications, Announcements, Documentation, Events/Meetings) is independent of Track A's tables aside from both referencing `employees` (read-only reference, not a conflict source).

---

## 6. Migration Ownership Rules (avoiding `schema.prisma` conflicts)

Since `prisma/schema.prisma` is a single shared file, follow these rules:

1. After Phase 0's initial full-schema migration, **each dev only adds/modifies models that belong to their own track's tables** listed in SCHEMA.md.
2. Before adding a new migration, **pull latest and rebase** — schema changes should be small, frequent, and reviewed via PR rather than large batched changes.
3. If a change is needed to a shared/foundation table (e.g., `employees`, `users`, `departments`), the dev proposing it must flag it to the other dev before merging — these are the only tables both tracks read from.
4. Never rename or drop a column both tracks might reference (`employees.id`, `departments.id`, etc.) without a heads-up — treat these as a stable contract.

---

## 7. Attendance Design (Track A) — v1 Manual Flow

No standalone worker needed for v1:

1. Employee taps **Clock In** → server writes `clock_in_raw` (server-generated timestamp, never trust a client-supplied time) to today's `attendance_records` row for that employee, creating the row if it doesn't exist.
2. Employee taps **Clock Out** later → server writes `clock_out_raw` on the same row.
3. Once both times exist, compute `total_hours` and `is_half_day` (< 5 hours) automatically.
4. HR/Admin get an **Attendance Review** screen: list of today's/this period's records, with the ability to **edit** `clock_in_approved`/`clock_out_approved` (defaulting to the raw values) and mark each record **Approved**.
5. Payroll's monthly deduction calculation (§ Payroll in PRD/Schema) only counts `approval_status = approved` records — this is important: make sure Track A's payroll logic filters on this, not on raw records, so an un-reviewed attendance record can't silently affect someone's salary.

### Future phase (not v1) — Biometric device LAN sync

Kept here for continuity only; do not build now. When revisited: a separate standalone Node/Python service runs on a machine with LAN/VPN access to the biometric device, polls it over port 4370 (e.g. via `pyzk`), writes raw punches through an internal API, and a nightly reconciliation job converts them into `attendance_records` with `source = device_sync` — with the manual clock-in/out flow remaining as a permanent fallback path even after this ships. Confirm the actual device model supports port 4370 SDK access with a half-day proof of concept before committing engineering time to this phase.

---

## 8. Milestones

**Milestone 1 (after Phase 0, ~Week 1):**
- Track A: Employee CRUD, Department/Team CRUD + label config, manual Clock In/Clock Out flow.
- Track B: WorkUnit/SubUnit/WorkItem CRUD (Atomic mode only first — Tech), basic Requests module (leave type only first, HR/Admin approval only).

**Milestone 2 (~Week 2-3):**
- Track A: HR/Admin attendance review/edit/approve screen; payroll config + flat deduction calculation (reading only *approved* attendance).
- Track B: Metric task mode with monthly reset (Sales/BD), Daily Planning/EOD flow + point ledger, Reimbursement request type + approval flow (HR/Admin only).

**Milestone 3 (~Week 3-4):**
- Track A: Full payslip generation flow — Incentive/Bonus/Other Addition/Other Deduction manual fields, pulling in Track B's approved reimbursements and Employee-of-the-Month reference per §5, payslip PDF/view.
- Track B: Recognition leaderboard + Employee of the Month computation (per department, weekly/monthly), Notifications infrastructure, Announcements (with team/all/specific-team scoping), Employee Documentation upload, Event Management — birthday/anniversary banner + Meetings (creation, invitees, reminder scheduling).

**Milestone 4 (integration week):**
- Both devs: cross-test the two shared dependencies (payroll ↔ reimbursements, payroll ↔ employee-of-month reference), full RBAC pass across all screens (verify Employee/Lead/HR/Admin visibility boundaries match PRD §3 exactly — especially that only HR/Admin can approve leave/reimbursement requests and view salary data), and a shared bug-bash across both tracks' features.

---

## 9. Testing & Deployment

- Each track writes its own unit/integration tests for its API routes — no shared test files to conflict over (test files live next to their route folders).
- Use a shared `.env.example` (Phase 0) documenting all required env vars (DB connection, auth secret, S3 credentials, worker API key) so environment setup doesn't become a blocker later.
- CI: run `prisma migrate deploy` + lint + tests on every PR before merge, regardless of track, to catch schema drift early.
- Deploy web app and worker as two separate deployables from day one (per §1) — don't couple their release cycles.

---

## 10. Summary Checklist Before Coding Starts

- [ ] Phase 0 completed together (auth, RBAC, seed data, initial full schema migration, shared UI primitives)
- [ ] Both devs have read PRD.md, SCHEMA.md, API_SPEC.md in full
- [ ] Open questions in PRD §7 have been answered by the stakeholder (meeting reminder delivery channel, Employee of the Month tie-handling)
- [ ] `getApprovedReimbursementTotal(...)` and `getEmployeeOfMonthStatus(...)` helper function signatures agreed between both tracks (§5)
- [ ] Confirm monthly metric-target reset implementation approach (new row per month vs. reset-in-place) between Track B dev and whoever reviews the schema (see SCHEMA.md note under `work_items`)

> Biometric device LAN-sync proof-of-concept is **not required before starting v1** — it's deferred to a future phase (PRD §5.1.1).
