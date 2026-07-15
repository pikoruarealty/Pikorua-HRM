# Pikorua HRM

Internal HR management system for the Pikorua firm — org hierarchy, attendance, project/task tracking, payroll, requests, recognition, and events, in one system.

Built with **Next.js (App Router) + TypeScript + PostgreSQL + Prisma + Tailwind + shadcn/ui**, by two developers working in parallel feature tracks.

## Documentation (read these first)

Full context lives in [docs/](docs/):

1. [PRD.md](docs/PRD.md) — what we're building, why, feature specs, decisions log.
2. [SCHEMA.md](docs/SCHEMA.md) — database schema.
3. [IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) — architecture + the 2-dev track split.
4. [API_SPEC.md](docs/API_SPEC.md) — endpoints + roles per endpoint.

Live status: [progress.md](progress.md).

## Repo layout

```
pikorua-hrm/
├── apps/web/            # Next.js app (App Router)
│   ├── app/            # routes (app/api/v1/* + dashboard pages)
│   ├── lib/            # SHARED: db, auth, rbac, api envelope + cross-track helpers
│   └── components/ui/  # SHARED shadcn primitives
├── prisma/             # schema.prisma (full, shared) + seed.ts
└── docs/
```

## Getting started

> Requires **[Bun](https://bun.sh) ≥ 1.3** and a **PostgreSQL** database. (This project uses Bun as its package manager and runtime — Bun runs the TypeScript seed directly, no `tsx` needed.)

```bash
# 1. Install dependencies (from repo root — Bun workspaces)
bun install

# 2. Configure environment
cp .env.example .env          # then fill DATABASE_URL and AUTH_SECRET

# 3. Create the database schema + seed baseline data
bun run prisma:migrate        # first run creates the initial migration
bun run db:seed               # 3 departments, teams, one user per role

# 4. Run the app
bun run dev                   # http://localhost:3000
```

Seeded logins (default password `Password123!`): `admin@pikorua.test`, `hr@pikorua.test`, `tech.lead@pikorua.test`, `tech.emp@pikorua.test`, `sales.lead@pikorua.test`, `sales.emp@pikorua.test`, `bde@pikorua.test`.

## Testing & CI

Unit tests cover the pure business logic (payslip math, unpaid-leave period clipping, attendance time math, RBAC guards, rate limiter, password policy, env validation) using Bun's built-in runner — no extra dependencies:

```bash
bun run test          # or: bun test apps/web/lib
bun run typecheck
```

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs on every push/PR: installs, applies migrations against a clean Postgres 16, seeds, typechecks, lints, tests, and does a full production build (a full `next build` is the only thing that catches route-collision errors — see progress.md Phase 4).

## Production operations

- **Health check:** `GET /api/health` (unauthenticated) → `{ status, db }`; `503` when the DB is unreachable. Point the reverse proxy / uptime monitor here.
- **Env validation:** the server validates `DATABASE_URL`/`AUTH_SECRET`/`CRON_SECRET` at boot (`apps/web/lib/env.ts`). In production it **refuses to start** on a missing or placeholder `AUTH_SECRET`.
- **Security headers:** set for all routes in `apps/web/middleware.ts` (frame-deny, nosniff, referrer policy, permissions policy, HSTS in production). A strict CSP is a known follow-up (needs Next nonce plumbing).
- **Login protection:** rate-limited (5 tries / 15 min per IP+email, 20 / 15 min per IP, in-memory — single-instance assumption, same as the cron scheduler). Users change their own password at **Account Security** (`/settings`, `POST /api/v1/auth/change-password`, min 10 chars with mixed case + digit).
- **Audit trail:** every sensitive action (logins incl. failures, password changes, payslip generate/finalize, payroll config changes, attendance edits/approvals, request approve/reject/override, employee create/update/deactivate, holidays, admin overrides) is written to the append-only `audit_logs` table via `audit()` from `@/lib/audit`. Admin-only viewer at `/audit` (`GET /api/v1/audit-logs`).
- **Verbose logging:** structured console logs from `@/lib/log` (`LOG_LEVEL` env: `debug`/`info`/`warn`/`error`; defaults to debug in dev, info in production). Every request gets an `INFO [http] request rid=…` line and an `x-request-id` response header; every API failure gets a `WARN/ERROR [api]` line; every audited mutation gets an `INFO [audit]` line — correlate by timestamp/rid when debugging.
- **File uploads on disk:** employee documents **and profile photos** live under `<cwd>/uploads/` (outside `public/`, served only through authenticated routes) — include this directory in backups.

## Scheduled jobs (recognition, birthdays, meeting reminders)

The server runs an **in-process scheduler** (node-cron, started from `apps/web/instrumentation.ts` on boot) that fires the recognition snapshot, birthday/anniversary check, and meeting reminders. No external cron setup is needed — but this **assumes a single running server instance** (the GCP-VM deployment target). If the app is ever horizontally scaled, disable the scheduler and instead hit the CRON_SECRET-gated routes from one external crontab: `POST /api/v1/cron/{recognition-snapshot,birthday-check,meeting-reminders}` with `Authorization: Bearer $CRON_SECRET`.

## Track ownership

- **Track A — People, Time & Money** (Umang): employees, departments/teams, attendance, payroll. Detailed tasklist: (Track A owner to add one, mirroring `TRACK_B_TASKLIST.md`).
- **Track B — Work, Requests & Culture** (Bhavarth): tasks, daily planning, requests, recognition, notifications, announcements, docs, events. Detailed tasklist: [TRACK_B_TASKLIST.md](TRACK_B_TASKLIST.md).

Shared files (`prisma/schema.prisma`, `lib/auth`, `lib/rbac`, `lib/db`, `components/ui`, root/`apps/web` `package.json`, `CLAUDE.md`) require flagging the other dev before changing — full list in [CLAUDE.md](CLAUDE.md#shared-foundation-flag-the-other-dev-before-changing), see IMPLEMENTATION_PLAN §6.

## Contributing — shared-file warning hook

This repo ships a git hook that warns (never blocks) when a commit touches a shared-foundation file, to catch accidental cross-track edits before they cause a merge conflict. It's **opt-in per clone** — enable it once:

```bash
git config core.hooksPath .githooks
```

This only points git at the tracked `.githooks/` directory instead of `.git/hooks/`; it doesn't install anything or touch shared config. Each dev runs this locally if they want the reminder. The hook script lives at [.githooks/pre-commit](.githooks/pre-commit); its file list is kept in sync with the one in `CLAUDE.md`.
