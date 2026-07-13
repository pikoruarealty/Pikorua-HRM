# Handoff — Starting Track A Milestone 1

> Paste this whole file's contents as your first message in a fresh session to resume exactly here. `CLAUDE.md` loads automatically and has the standing rules + shared-file list; this doc is the specific "where we are, what's next" context on top of that.

## Where things stand

- Repo: `Pikorua-HRM`, currently on branch **`track-a`** (already branched off `main`).
- **Phase 0 is fully verified** (commit `a8568ff` on `track-a`): local Postgres 16 running, `pikorua_hrm` DB created, `.env` populated, `bun run prisma:migrate` applied (`migrations/20260713100632_init`), `bun run db:seed` succeeded (7 seeded users, password `Password123!`), login (`POST /api/v1/auth/login`) + `GET /api/v1/auth/me` verified live against `bun run dev`, and `bun run build` compiles clean.
- `docs/TRACK_A_TASKS.md` has the full detailed Track A breakdown (Phase 0 → Milestone 1 → 2 → 3 → 4). **This handoff is about starting Milestone 1 from that file.**
- Shared-file rules live in `CLAUDE.md` under "Shared files" — stop and flag before editing anything on that list (schema.prisma, lib/rbac, lib/auth, lib/api, lib/db, components/ui, the two Track B cross-track stubs). There's also an opt-in `.githooks/pre-commit` warning (`git config core.hooksPath .githooks` to enable it locally).
- Local dev environment note: `bun` is installed at `~/.bun/bin/bun` but isn't on a non-interactive shell's `PATH` by default — prefix commands with `export PATH="$HOME/.bun/bin:$PATH"` if a fresh shell can't find `bun`.

## What Milestone 1 is (from docs/TRACK_A_TASKS.md)

Three sub-areas, in this order (each depends on the previous existing):

1. **Departments** — `GET/POST /api/v1/departments`, `GET/PUT /api/v1/departments/:type_key/labels`, Admin label-config screen. New `components/departments/` folder.
2. **Teams** — `GET/POST/PATCH /api/v1/teams`, validating `team_lead_id` against `isLeadRole()` from `lib/rbac` (read-only use, no edit needed there).
3. **Employees** — full CRUD (`GET` list w/ mandatory server-side role scoping, `GET :id`, `POST`, `PATCH`, `DELETE` soft-delete), employee list/detail/form dashboard, `components/employees/`.

## Open decision to resolve before/at the Employees task

**Not yet answered:** does `POST /employees` provision a linked `User` login (email + password) in the same call, or is that a separate step? This changes the endpoint's request/response contract. Ask the user (Umang) before writing that endpoint — don't assume either direction.

## Immediate next steps for the fresh session

1. Confirm still on `track-a` branch, working tree clean (`git status`).
2. Start with **Departments** (1. above) since Teams and Employees both reference `department_id`.
3. Follow the shared-file stop-and-flag rule the moment any task would touch `prisma/schema.prisma` (it shouldn't for Milestone 1 — `Department`, `Team`, `Employee`, `DepartmentLabel` models already exist in the schema from Phase 0) or any other shared file.
4. Resolve the employee-login open decision (via AskUserQuestion or direct conversation) before implementing `POST /employees`.
5. Update `progress.md`'s Track A table incrementally as each of the three sub-areas completes — don't batch it.
