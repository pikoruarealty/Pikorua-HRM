# Pikorua HRM — Product Requirements Document (PRD)

> **Purpose of this document:** This is the single source of truth for the Pikorua HRM project. It contains full context so that anyone (including a fresh AI assistant session with no prior memory of this project) can pick this up and understand exactly what is being built, why, and what has already been decided. Read this document fully before writing any code.

---

## 1. Project Overview

**Project name:** Pikorua HRM (Human Resource Management system)

**Origin:** This project was scoped out from a whiteboard mind-map session for the Pikorua firm. It is an internal tool — not a customer-facing product — meant to replace ad hoc/manual HR processes (attendance, payroll, leave, project tracking, recognition) with a single system.

**Team:** 2 developers — **Umang** and **Bhavarth** — building the entire product together (no strict frontend/backend split — see Implementation Plan for how work is divided).

**Core idea:** The system ties together org structure, attendance, project/task execution, and performance metrics into one feedback loop:

```
Tasks completed → Task Points / Targets → Employee Metrics → Incentives & Recognition → Payroll
```

Attendance and task performance directly feed into salary calculation, not just informational dashboards.

---

## 2. Goals

- Give Pikorua a single internal system for: attendance, payroll, org hierarchy, project/task tracking, employee metrics, recognition, leave/requests, and (later) assets.
- Make the system **scalable to new departments** in the future without schema changes — department-specific terminology (e.g. "Project" vs "Campaign") should be configurable, not hardcoded.
- Replace **manual, spoofable attendance entry** with real biometric device data.
- Avoid the "90% done" problem in tech task tracking by making tech tasks atomic (binary complete/incomplete), while still allowing genuinely partial, numeric progress for non-tech departments (e.g., sales calls, meetings).

## 2.1 Non-Goals (explicitly out of scope for v1)

- Full asset management (laptops, hardware tracking) — stubbed only, real build deferred until the company has assets worth tracking.
- Automatic/algorithmic incentive calculation for non-tech departments — for v1, non-tech incentive/bonus is entered manually by HR/Admin as free text at payslip generation time. Unifying tech task-points and non-tech targets into one incentive formula is explicitly deferred.
- Any external payroll/accounting system integration (e.g., Tally, QuickBooks) — not discussed, treat as out of scope unless a stakeholder specifies otherwise.
- Statutory compliance calculations (PF, ESI, TDS, etc.) — not mentioned in original scope; **flag this to the stakeholder before building payroll**, since Indian payroll typically requires this. Do not assume it's out of scope silently — confirm.

---

## 3. User Roles & Permissions

| Role | Scope |
|---|---|
| **Admin** | Full access to everything, including all financial data (salary, incentives, reimbursements) across the org. |
| **HR** | Same financial/administrative access as Admin (salary, incentives, reimbursements, approvals) — the only two roles that can view or edit salary/incentive/reimbursement data. |
| **Sales Lead / Tech Lead** ("Team Lead" roles) | Can view their **own team's** data — team members' attendance, task/target progress, project status. Cannot see salary, incentive amounts, or reimbursement details of any employee, including their own team. |
| **Sales Employee / Tech Employee / BDE** ("Employee" roles) | Can view only their **own** data (attendance, tasks, points/targets, leave/request status) plus **project status** visibility relevant to their work. Cannot see any other employee's data, and cannot see salary/incentive/reimbursement info even for themselves beyond their own payslip once generated. |

**Golden rule:** Salary, incentive amount, bonus amount, and reimbursement approval/data are visible **only to Admin and HR**, full stop, regardless of any other role.

Departments currently defined: **Tech**, **Sales**, **B.D. (Business Development)**. The system must support adding new departments later without code changes (see Section 4).

---

## 4. Core Domain Model: Generic Tree Hierarchy

The org and work structure is a **tree**, and it must be **generic/scalable** so that new departments (beyond Tech/Sales/BD) can be added later just by configuration, not new schema or code.

```
Department (has a "type" — e.g. Tech, Sales, BD, or any future type)
 └─ Team (Team 1 ... Team-n)
     └─ Team Lead + Team Members
 
Department → WorkUnit → SubUnit → WorkItem   (generic structure, see below)
```

### 4.1 Department-specific labels

The underlying schema is identical for every department, but the **display labels** differ per department type. This is configured once per department (e.g. in a JSON config or DB table), not hardcoded in the UI.

| Generic term | Tech label | Sales/BD label (example) |
|---|---|---|
| WorkUnit | Project | Campaign |
| SubUnit | Feature | Target Segment / Deal Stage |
| WorkItem | Task | Call / Meeting / Follow-up |

This label-mapping table itself should be stored as data (not hardcoded strings scattered across the UI), so a 4th department (e.g. "Support" or "Marketing") can be onboarded by an Admin adding a new department type + label set, no redeploy needed.

### 4.2 WorkItem types: Atomic vs Metric

This is a critical design decision — **do not merge these two into one task type**:

- **Atomic task** (used by Tech): binary state only — Pending / WIP / Completed. No partial-percentage state is allowed. On completion, the task's pre-assigned **task point** value (set by the Team Lead when the task is created) is added to the employee's point balance. This exists specifically to avoid the "90% done" false-progress problem in dev work.
- **Metric task** (used by Sales/BD, and any future department with quantifiable partial progress): has a **numeric target** and a **running current count** (e.g., target = 100 calls, current = 50). Progress = current / target. There is no task-point conversion for these in v1 — see Section 6.2.

---

## 5. Feature Modules (Full Spec)

### 5.1 Attendance / Leave / Half-days

- **v1 approach (decided): manual clock-in/clock-out, with HR/Admin approval and edit rights.** The biometric device LAN-sync integration (previously scoped) is **on hold** and deferred to a later phase — see 5.1.1 below. Do not build the device worker in v1.
- **v1 flow:**
  1. Employee taps a **Clock In** button (timestamped by the server, not client-supplied) at the start of their day, and a **Clock Out** button at the end.
  2. This raw clock-in/out record is visible to **HR/Admin**, who can **review, edit, and approve** the recorded times (to correct forgotten clock-outs, mistaken entries, etc.). Until approved, the record should be treated as provisional for payroll purposes.
  3. Approved attendance records feed into the monthly deduction calculation (late/half-day/leave) in payroll.
- **Half-day definition:** an employee is marked half-day if their total clocked time for the day is **under 5 hours**.
- **Leave types:** Paid and Unpaid. Leave is one type of a more general **Request** entity (see Section 5.9). **Leave requests are approved only by HR/Admin** (not Team Leads — see 5.9).
- Attendance record fields: Employee ID, Date, Clock-In timestamp, Clock-Out timestamp, Approval status, Approved/edited by (HR/Admin user), Edit history (for audit — keep the original clock times alongside any HR/Admin edits).

#### 5.1.1 Future phase — Biometric device LAN sync (on hold, not v1)

Kept here for context continuity; do not build in v1:

- A "Team Office"-branded biometric device (ZKTeco/eSSL-family hardware) is already installed at the office. When revisited, the planned integration is a direct LAN connection over **TCP/UDP port 4370** using an open SDK client (e.g. `pyzk`), run as a separate background worker polling the device and pushing punches into the system — avoiding the vendor's paid cloud API subscription.
- When this phase starts: map each employee to their device-internal biometric User ID (UID), watch for device clock drift and duplicate punches on restart (dedupe by UID + direction + timestamp within ~60 seconds), and keep the manual clock-in/out flow as a fallback path even after device sync is live.

### 5.2 Payroll / Salary Slip / Incentive / Bonus

- **Base salary**: entered when an employee is created; editable afterward by HR/Admin.
- **Incentive** and **Bonus**: entered as a **free-text/manual amount box** by HR/Admin at the time of generating each month's salary slip. Not auto-calculated in v1 (see Section 6.2 for why).
- **Pay is earnings-based, not "base salary minus deductions"** (changed 2026-07-17, twice same day — the first pass made deductions salary-proportional, the second fixed a deeper issue: 0 present days must not still net most of a month's salary):
  - **Per-day rate** = `base_salary ÷ 30` (fixed 30-day-month convention, not the actual days in the calendar month).
  - **Earned base pay** = `(present_days + half_days×0.5 + paid_leave_days + holiday_days + compensation_days) × per_day_rate`. Present, half-day (at half rate), paid leave, holidays, and compensation days are all **paid**; **absent and unpaid-leave days are simply excluded — not being paid for the day is the only consequence, no separate punitive deduction, and both are treated identically.**
  - Weekend rule: only **Sunday** is a day off; Saturday is a normal working day. A clock-in on a Sunday is a **compensation day** — paid at the normal per-day rate (no overtime premium), not a normal present day.
  - **Late-coming** is a separate penalty on top of earned base pay: a **configurable percentage** of one day's pay, per late occurrence (percentage set by Admin, in `payroll_config` — e.g. 20% of a ₹1,000 day-rate = ₹200 per late day).
- **Reimbursements**: submitted as a Request type, approved by HR/Admin, and once approved, added into the payslip.
- **Other Additions** and **Other Deductions**: at payslip generation time, HR/Admin can add free-text/free-amount **"Other Addition"** (antonym of deduction — any ad-hoc positive line item not covered by Incentive/Bonus/Reimbursement) and **"Other Deduction"** (any ad-hoc negative line item not covered by the standard late/leave/half-day deductions) entries. These are manual, one-off, per-payslip line items — not recurring config.
- **Statutory deductions (PF/ESI/TDS) are explicitly out of scope for v1** — not needed right now, confirmed. Do not build automatic statutory calculation; if ever needed later, it would likely fit as another "Other Deduction" line item initially, or a dedicated module if legally required.
- **Employee of the Month reference:** at payslip generation time, HR/Admin should see the current month's **Employee of the Month per department** (derived from the Recognition aggregation — see Section 5.8) displayed for reference, to help inform the Incentive/Bonus amount they enter manually. This is informational only — it does not auto-populate any amount.
- **Payslip** = Earned base pay (present + half-day×0.5 + paid leave + holiday + compensation days, × the per-day rate) + Incentive (manual) + Bonus (manual) + Other Additions (manual) − Late deduction (late% × per-day rate) − Other Deductions (manual) + Approved reimbursements.
- Only **Admin and HR** can generate, view, or edit salary slips, incentives, reimbursements, and other additions/deductions for any employee.

### 5.3 Hierarchy

- Represented as a **tree structure** (JSON-serializable), reflecting Department → Team → Team Lead/Members, and separately Department → WorkUnit → SubUnit → WorkItem for project/task tracking.
- Must support arbitrary depth/generic labeling per Section 4.

### 5.4 Day Planning / EOD (End of Day)

- **Scrum-like daily flow**:
  1. At **clock-in**, the employee selects which task(s)/WorkItem(s) they intend to work on that day (from tasks assigned to them or their team, created and point-valued by the Team Lead).
  2. Through the day, the employee marks progress on selected tasks (for Atomic tasks: move between Pending → WIP → Completed; for Metric tasks: update the running count).
  3. At **EOD**, tasks marked Completed have their task-point value added to the employee's running point balance for that period.
- Task points are assigned **by the Team Lead**, per task, per feature/SubUnit — not automatically generated.
- **Lead/Admin visibility (2026-07-23):** `GET /attendance/task-progress` gives Team Leads (every team they lead + self) and Admin/HR (whole company) a live, all-employees-at-once view of who has clocked in, what they selected today, and real-time completion progress — no need to query one employee's EOD at a time. `GET /employees/:id/task-activity` gives the same audiences (plus the employee themself) a per-employee task history broken down by period (daily/weekly/monthly/total), with each task's project, sub-unit, assignment date, and completion date.

### 5.5 Department → Teams

- Department contains one or more Teams (Team 1 ... Team-n).
- Each Team has exactly one Team Lead and one or more Team Members.
- Team Lead can view their team's attendance, task progress, and project status (not salary/incentive/reimbursement data) — see §5.4 for the live task-progress and per-period task-activity surfaces this is implemented through.

### 5.6 Project → People/Tasks → Tracking

- See Section 4.2 for Atomic vs Metric WorkItem types.
- Every WorkUnit (Project/Campaign) has a Team Lead, and is broken into SubUnits (Features/Target Segments), which contain WorkItems (Tasks/Calls etc.), each assigned to Team Members.
- Status values for Atomic tasks: **Pending → WIP (Work in Progress) → Completed**.
- Metric tasks track: target value, current value, and derive percentage complete — no fixed "done" state required, since the department may define its own completion threshold conventions (e.g., is 100/100 calls "done," or is a Metric task inherently ongoing/recurring — clarify per department if needed, but default to target-reached = complete).

### 5.7 Employee Metrics

- **Tech department:** measured by **Task Points** accumulated via completed Atomic tasks.
- **Non-tech departments (Sales/BD):** measured by **Targets** — numeric goals with partial/running progress (Metric tasks). **Sales/BD targets reset every month** (a fresh target period each month), but the target value itself can be updated/edited at any time by the Team Lead (e.g., mid-month adjustment), not just at reset.
- These two metric systems are **kept separate for v1** — no unified scoring/conversion between task points and target-percentage. HR/Admin manually factor performance into the Incentive/Bonus text box at payslip time instead of relying on an automated formula.

### 5.8 Employee Recognition (Weekly / Monthly) & Employee of the Month

- Weekly and Monthly aggregate of Task Points (Tech) or Sales Value/target performance (Sales/BD) is computed **per department**, and used to determine an **Employee of the Month per department**.
- This Employee of the Month designation is surfaced at **payslip generation time** (see 5.2) as a reference point for HR/Admin when deciding Incentive/Bonus amounts — it is informational, not an automatic payroll trigger.
- Recognition is otherwise a visibility/leaderboard feature (weekly + monthly views), not tied to any automated formula in v1.

### 5.9 Requests (generalized — includes Leave)

- Built as **one generic Request entity**, not a leave-specific one, since multiple request types are expected (leave, reimbursement, WFH, asset request, and future types).
- Fields: Requesting Employee, Request Type (enum: `leave_paid`, `leave_unpaid`, `reimbursement`, `wfh`, `other` — extensible), Status (`pending`/`approved`/`rejected`), Approver, supporting notes/attachments where relevant (e.g., reimbursement receipts).
- **Approval routing (decided):**
  - **Leave requests → approved only by HR/Admin** (not Team Leads).
  - **Reimbursement requests → approved only by HR/Admin** (financial data).
  - Team Leads can view their team's request statuses (visibility only, per the standard role scope in Section 3) but cannot approve/reject leave or reimbursement requests themselves.

### 5.10 Notifications / Announcements / Documentation

- **Notifications**: application-wide, triggered by relevant events (e.g., leave approved/rejected, task assigned, birthday/anniversary today, meeting reminders — see Event Management below). Should be a generic notification service that any module can push into, not hardcoded per feature.
- **Announcements (decided — has types/scoping):**
  - **Team announcements**: created by a **Team Lead**, visible only to their own team.
  - **All-company announcements**: created by **HR/Admin**, visible to everyone.
  - **Specific-team(s) announcements**: created by **HR/Admin**, visible to one or more selected teams (not necessarily all).
  - Team Leads cannot create all-company or cross-team announcements — only HR/Admin can target beyond their own team.
- **Documentation**: employee documents collected **at time of hiring** (ID proofs, contracts, certificates, etc.), stored for future reference. Access restricted to HR/Admin and the employee themselves (for their own documents).

### 5.11 Event Management

Two event types in v1:

1. **Birthday / Work Anniversary reminders** (system-generated, not manually created): on login, if any employee has a birthday or anniversary that day, a **notification/banner** is shown to all employees (celebratory, not private).
2. **Meetings** (manually created): a Meeting event can be created by **Admin, HR, or a Team Lead**, with a list of invited people/groups/teams and a scheduled date/time. The system sends a **reminder notification to all invitees** some configurable amount of time before the meeting starts (e.g., "15 minutes before" — the lead time should be settable per meeting, not a fixed global value).

### 5.12 Asset Management

- **Deferred** — not built in v1. Placeholder module only. When the company has physical assets (laptops, etc.) to track, this will log asset ID, assigned employee, status, and history/whereabouts log. Do not over-engineer this now; just leave room in the schema/nav for it.

### 5.13 Expense & Reimbursement

- Submitted as a Request (`reimbursement` type, see 5.9), approved by HR/Admin, then reflected in the next payslip as an addition.

---

## 6. Key Design Decisions Log (why things are the way they are)

This section exists so a new developer/session doesn't re-litigate decisions already made.

1. **Task points vs. Targets are NOT unified.** Tech uses atomic task completion + fixed task points (assigned by Team Lead). Sales/BD uses numeric targets with partial progress, resetting monthly (editable anytime). No conversion formula between them exists in v1 — incentive amounts are manually entered by HR/Admin instead, informed by the Employee of the Month reference (5.8). Revisit only once there's real usage data from both departments.
2. **Deductions are flat amounts**, not percentage-of-salary based. E.g., "₹500 per late mark" as a global config, not "1 day's salary / 30." **Statutory deductions (PF/ESI/TDS) are explicitly excluded from v1** — confirmed not needed right now.
3. **Attendance is manual clock-in/clock-out in v1, with HR/Admin approval and edit rights.** The biometric device LAN-sync integration is on hold/deferred — see PRD 5.1.1. Do not build the device worker or the internal device-sync endpoint in v1; keep the schema flexible enough to add it later without a rework (see Schema doc).
4. **Requests are a single generic entity** with a `type` enum, not separate tables/flows per request type — this avoids rebuilding approval workflows for every new request type that comes up. **Leave and Reimbursement requests are both approved only by HR/Admin**, never by Team Leads.
5. **Org/work hierarchy uses a generic tree schema with department-specific label configuration**, so new departments can be onboarded via configuration, not code changes.
6. **Tech stack: Next.js (App Router) + PostgreSQL**, plus a lightweight scheduled-jobs mechanism for recognition aggregation and birthday/meeting-reminder checks (no LAN-dependent worker needed in v1 now that device sync is deferred). See Implementation Plan for full rationale.
7. **Asset management and non-tech incentive automation are explicitly deferred** — do not build them in v1 beyond stubs/placeholders.
8. **Announcements have three scopes**: Team Lead → own team only; HR/Admin → all-company or specific selected teams.
9. **Meetings are a distinct Event type** (alongside system-generated birthday/anniversary events), creatable by Admin/HR/Team Lead, with a per-meeting configurable reminder lead time sent to all invitees.
10. **Payslips support ad-hoc "Other Addition" and "Other Deduction" manual line items**, separate from the standard Incentive/Bonus/Reimbursement/late-leave-halfday fields, for anything one-off that doesn't fit the standard categories.

---

## 7. Open Questions (flag to stakeholder, do not assume)

- Multiple biometric devices at multiple office locations — relevant only once the device-sync phase (5.1.1) is revisited; not needed for v1 manual attendance.
- Meeting reminder delivery channel — in-app notification only, or also email/SMS? Assume in-app only for v1 unless specified.
- Employee of the Month — is this a single winner per department, or can there be ties/multiple recognitions? Default assumption: single top performer per department per month, but confirm before building the UI.

---

## 8. Glossary

- **WorkUnit / SubUnit / WorkItem**: generic tree levels standing in for Project/Feature/Task (Tech) or Campaign/Target Segment/Call (Sales/BD) etc.
- **Task Point**: a point value assigned by a Team Lead to an Atomic WorkItem, credited to an employee on completion.
- **Metric Task**: a WorkItem with a numeric target and running count instead of binary completion.
- **Per-day rate**: `base_salary ÷ 30` — the fixed-30-day-month figure earned base pay and the late deduction are both computed against (replaced the old flat ₹-amount-per-occurrence model, 2026-07-17).
- **Earned base pay**: `(present + half-day×0.5 + paid leave + holiday + compensation days) × per_day_rate` — what an employee actually earned for the period, replacing "full base salary minus deductions" (2026-07-17). Absent/unpaid-leave days are excluded from it, not separately deducted.
- **Compensation day**: a Sunday on which an employee clocks in — paid at the normal per-day rate (counted into earned base pay like a present day, no overtime premium), never netted against absences.
- **UID (device)**: the biometric device's internal integer identifier for a fingerprint/face profile, mapped to an employee record (relevant only once the deferred device-sync phase, 5.1.1, is built).
- **Other Addition / Other Deduction**: ad-hoc, manual, one-off ₹ line items entered by HR/Admin at payslip generation time, for anything not covered by the standard Incentive/Bonus/Reimbursement or late/leave/half-day deduction fields.
- **Employee of the Month**: the top performer per department for a given month, derived from the Recognition aggregation (task points for Tech, target performance for Sales/BD), surfaced as a reference at payslip generation time.
