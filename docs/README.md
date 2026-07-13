# Pikorua HRM — Project Docs

Start here. This folder is the full context handoff for the Pikorua HRM project — read these in order:

1. **[PRD.md](./PRD.md)** — What we're building, why, all feature specs, and the decisions log (read this first, especially if you're a fresh session with no prior context on this project).
2. **[SCHEMA.md](./SCHEMA.md)** — Database schema (PostgreSQL/Prisma-ready).
3. **[IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)** — Architecture, repo structure, and how the 2-developer team splits work by feature (not frontend/backend) to avoid merge conflicts.
4. **[API_SPEC.md](./API_SPEC.md)** — Full endpoint list with roles/permissions per endpoint.

## One-paragraph summary

Pikorua HRM is an internal system tying together org hierarchy, attendance (manual clock-in/out with HR/Admin approval in v1; biometric device LAN sync deferred to a future phase), project/task tracking (Scrum-like/atomic for Tech, monthly-resetting targets for Sales/BD), payroll (auto-deductions + manual incentive/bonus/other-addition/other-deduction fields, with Employee-of-the-Month shown for reference), leave/reimbursement requests (HR/Admin approval only), employee recognition, and event management (birthdays + meetings). Built with Next.js + PostgreSQL, developed by two engineers — **Umang** and **Bhavarth** — split into two feature-based tracks — **Track A: People, Time & Money** (employees, attendance, payroll) and **Track B: Work, Requests & Culture** (task tracking, requests, recognition, notifications, events) — so both can build full-stack, in parallel, without stepping on each other's files.

## Before writing code

Confirm the remaining open questions in PRD §7 with the stakeholder — meeting reminder delivery channel (in-app only vs. also email/SMS) and how Employee of the Month ties are handled. Statutory payroll deductions (PF/ESI/TDS) have already been confirmed as **out of scope for v1**, and the biometric device LAN-sync integration has been confirmed **on hold** in favor of manual clock-in/out for v1.
