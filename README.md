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
