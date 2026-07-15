# Handoff: Phase 7 Production Hardening (2026-07-15)

## What was done this session

**Status:** Complete, all live-verified, uncommitted on `main` (ready for review & commit).

The Pikorua HRM v1 feature set was already complete (Phases 0–6: all Track A + Track B modules, wired UI, in-process cron scheduler). This session added the **production hardening layer** every enterprise HR system needs: audit trail, brute-force protection, password self-service, security headers, health probe, env validation, unit tests (43 all passing), and GitHub Actions CI.

### Core additions

1. **Audit trail** (`audit_logs` table + `@/lib/audit`)
   - Append-only table (migration `20260715105718_add_audit_logs` applied)
   - `audit()` helper: call after every sensitive mutation (never throws; failures logged to console)
   - Tracks: login/failed/rate-limited, change-password, payslip gen/finalize, payroll config, attendance edit/approve, request approve/reject, employee CRUD (salary changes record old→new)
   - Admin-**only** viewer: `/audit` page + `GET /api/v1/audit-logs` (pagination, filters by action/actor/entity/date)
   - Live-verified: 403 for HR/employees, real rows for all event types
   - **New standing rule (CLAUDE.md):** sensitive mutations must call `audit()` after commit

2. **Login brute-force protection** (`@/lib/security/rate-limit.ts`)
   - In-memory sliding window (injectable clock, self-sweeping, **single-instance assumption** documented)
   - Per (IP, email): 5 tries / 15 min → 429 RATE_LIMITED
   - Per IP: 20 tries / 15 min → 429
   - Strikes clear on successful login
   - Live-verified: five 401s, then 429 with Retry-After header
   - All login attempts (success/failed/rate-limited) are audited

3. **Password self-service** (`@/lib/security/password-policy.ts` + new endpoints/pages)
   - `POST /api/v1/auth/change-password`: re-verifies current password, audited, rate-limited
   - Policy: ≥10 chars, mixed upper/lower case, ≥1 digit
   - New `/settings` page (all roles) — "Account Security" with change form
   - Live-verified: weak password 422, wrong current 401, successful change + login with new pw works

4. **Security headers** (`apps/web/middleware.ts`)
   - X-Frame-Options: DENY
   - X-Content-Type-Options: nosniff
   - Referrer-Policy: strict-origin-when-cross-origin
   - Permissions-Policy: camera/microphone/geolocation denied
   - HSTS (Strict-Transport-Security) in production only
   - **Known follow-up:** CSP (needs Next nonce plumbing for the theme boot script + inline Next scripts)

5. **Operations** (`@/lib/env.ts` + new health route)
   - `GET /api/health` (public, unauthenticated): `{status, db}`, 503 if DB unreachable
   - Boot-time env validation: in production, server **refuses to start** on:
     - Missing DATABASE_URL
     - Missing AUTH_SECRET
     - AUTH_SECRET < 32 chars
     - Placeholder AUTH_SECRET (contains "change-me", "example", etc.)
   - Placeholder CRON_SECRET only warns (dev-friendly)

6. **Unit tests** (43 tests, all pass, zero new deps, `bun test`)
   - **Pure logic extraction (testable without DB):**
     - `@/lib/payroll/calc.ts`: `computeStandardDeductionTotal()`, `computeNetPay()` — includes Phase 5 live-verified 56300 case
     - `@/lib/requests/leave-math.ts`: `countDaysClippedToPeriod()`, `periodBounds()` — boundary-spanning ranges (Jul 30 – Aug 2 → July 2 / Aug 2 / June 0)
     - `@/lib/attendance/time.ts`: `computeHours()` (half-day at exactly 5h, negative-duration clamp), `isLateArrival()`, `isValidHHMM()`
   - **Domain logic:** RBAC golden rule (Leads never pass FINANCE_ROLES), rate limiter (entries expire, remaining counts down, keys independent), password policy (all three checks), env validation (placeholder detection)
   - Test files: `**/*.test.ts` excluded from `tsc` (bun ships its own types)

7. **CI** (`.github/workflows/ci.yml`)
   - On every push/PR: install (frozen lockfile) → migrate against clean Postgres 16 → seed → typecheck → lint → tests → full `next build`
   - Full `next build` is critical (catches route-collision errors that `tsc --noEmit` misses, per Phase 4 incident)

8. **Navigation updates**
   - New "System" group: "Account Security" (all roles) + "Audit Log" (Admin only)
   - `NavCtx` extended with `isAdmin` flag

### Shared files touched (flagged per standing rule)

- `prisma/schema.prisma` — added `AuditLog` model + `User.auditLogs` back-relation
- `lib/requests/leave.ts` — pure-math extraction only (signature/behavior **unchanged**, just moved date-clipping logic to `leave-math.ts`)
- Root & `apps/web` `package.json` — test scripts only (`bun run test`), **zero new npm dependencies**
- `CLAUDE.md` — new audit convention documented
- API_SPEC.md & README.md — added auth/ops sections, production operations guide

**Not touched (intact):** `lib/auth`, `lib/rbac`, `lib/db`, `components/ui`, cron scheduler, schema migrations (except the new audit one).

## How to continue

### Verify everything still works
```bash
cd /home/umang/Desktop/Pikorua/Pikorua-HRM
export PATH="$HOME/.bun/bin:$PATH"

# 1. Tests
bun run test                    # 43 pass
bun run typecheck              # clean
bun run lint                   # clean

# 2. Production build
bun run build                  # compiles clean, middleware included

# 3. Live smoke test (optional — starts a dev server)
cd apps/web && PORT=3057 bun run dev &
# In another terminal:
curl http://localhost:3057/api/health  # {status: ok, db: up}
# curl test suite in the scratchpad has examples of:
#   - brute force (6 bad logins → 429 on the 6th)
#   - change-password (weak policy, wrong current, valid change)
#   - audit log RBAC + contents
#   - payslip generation + audit trail
# Kill the dev server when done
```

### To commit the changes
```bash
git status  # 43 files modified + 18 new (audit/settings/health/test routes, test files, CI, etc.)

# Recommended flow: review, then commit as a single PR
# (the changes are cohesive — they're all production hardening, not independent features)

# Commit message:
git commit -m "Phase 7: production hardening — audit trail, login rate limiting, password change, security headers, health check, tests, CI"
```

### Files to know about (new in this session)

**Core libraries (production code):**
- `apps/web/lib/audit/index.ts` — `audit()` helper + `clientIp()`
- `apps/web/lib/security/rate-limit.ts` — in-memory sliding-window limiter
- `apps/web/lib/security/password-policy.ts` — password strength checks
- `apps/web/lib/payroll/calc.ts` — **NEW extracted pure math** (testable, used by generate route)
- `apps/web/lib/requests/leave-math.ts` — **NEW extracted pure math** (period clipping)
- `apps/web/lib/env.ts` — boot-time env validation
- `apps/web/middleware.ts` — security headers for every response

**Routes (new):**
- `apps/web/app/api/v1/auth/change-password/route.ts`
- `apps/web/app/api/health/route.ts` (not under /api/v1)
- `apps/web/app/api/v1/audit-logs/route.ts`

**Pages (new):**
- `apps/web/app/(dashboard)/settings/page.tsx` — Account Security
- `apps/web/app/(dashboard)/audit/page.tsx` — Audit Log viewer

**Components (new):**
- `apps/web/components/settings/security-screen.tsx`
- `apps/web/components/audit/audit-screen.tsx`

**Tests (new):**
- `apps/web/lib/payroll/calc.test.ts`
- `apps/web/lib/requests/leave-math.test.ts`
- `apps/web/lib/attendance/time.test.ts`
- `apps/web/lib/security/rate-limit.test.ts`
- `apps/web/lib/security/password-policy.test.ts`
- `apps/web/lib/env.test.ts`
- `apps/web/lib/rbac/rbac.test.ts`

**CI:**
- `.github/workflows/ci.yml` — runs on every push/PR

**Documentation updates:**
- `progress.md` — Phase 7 full entry (summary + details)
- `README.md` — Testing & CI section + Production operations section
- `docs/API_SPEC.md` — auth additions (change-password, rate-limit), new §9b (health/audit-logs)
- `CLAUDE.md` — audit convention added to standing rules

## Known follow-ups (logged, not blockers)

1. **CSP (Content Security Policy)** — currently deferred. Next 14's inline scripts need nonce plumbing before a strict CSP would be effective. Low urgency unless you're on a high-security cert.
2. **List endpoint pagination caps** — `/employees`, `/attendance`, `/requests` currently unbounded (no `limit` param). Add caps to prevent someone accidentally querying 50k rows.
3. **Session revocation after password change** — JWTs stay valid until expiry even after the password is changed. Option: add a `passwordChangedAt` field to User, check it server-side for every authenticated request.
4. **Email notification channel** — Notifications currently in-app only. Add SendGrid/AWS SES if you want email on login attempts, password changes, payslip generation, etc.
5. **Payslip PDF export** — currently returns JSON. PDF would be nice for archival/printing. Use `react-pdf` or `pdfkit` behind a new `/payslips/:id/pdf` route.
6. **DB backups on the GCP VM** — document or automate `pg_dump` to Cloud Storage on a nightly cron.

## Context for the next person

- **Single-instance assumption:** The in-memory rate limiter and cron scheduler both assume one running server process. If you scale horizontally, replace the rate limiter with Redis and disable the in-process scheduler (hit the CRON_SECRET-gated routes from an external crontab instead).
- **Audit is append-only:** Rows are never updated or deleted. If you ever need to archive old rows, export them first, then delete, then rebuild the admin /audit viewer to handle pagination past the archive.
- **Development experience:** The shared-file list in `CLAUDE.md` (and `.githooks/pre-commit`) reminds devs of the Track A/B split — keep it in sync if you add to it.
- **Testing discipline:** The unit tests cover pure logic extracted into libraries. If you add a new calculation (e.g., statutory deductions later), extract it into a pure function and test it before wiring it into the route.

## Next session: likely work

- Review the uncommitted changes (`git diff`, `git log`)
- If happy, commit + push
- The follow-ups list is optional — none of them block v1 production deployment

---

**All changes are on `main`, uncommitted, ready for your review.**

Summary of `git status`:
```
Modified (21):
  CLAUDE.md, README.md, package.json, prisma/schema.prisma,
  progress.md, docs/API_SPEC.md,
  apps/web/package.json, apps/web/tsconfig.json,
  apps/web/instrumentation.ts,
  apps/web/app/(dashboard)/layout.tsx,
  apps/web/components/shell/nav-config.ts,
  apps/web/lib/requests/leave.ts,
  apps/web/app/api/v1/auth/login/route.ts,
  apps/web/app/api/v1/payslips/[id]/finalize/route.ts,
  apps/web/app/api/v1/payslips/generate/route.ts,
  apps/web/app/api/v1/payroll/config/route.ts,
  apps/web/app/api/v1/employees/route.ts,
  apps/web/app/api/v1/employees/[id]/route.ts,
  apps/web/app/api/v1/attendance/[id]/edit/route.ts,
  apps/web/app/api/v1/attendance/[id]/approve/route.ts,
  apps/web/app/api/v1/requests/[id]/approve/route.ts,
  apps/web/app/api/v1/requests/[id]/reject/route.ts

New files (22):
  .github/workflows/ci.yml,
  apps/web/middleware.ts,
  apps/web/app/api/health/route.ts,
  apps/web/app/api/v1/audit-logs/route.ts,
  apps/web/app/api/v1/auth/change-password/route.ts,
  apps/web/app/(dashboard)/audit/page.tsx,
  apps/web/app/(dashboard)/settings/page.tsx,
  apps/web/components/audit/audit-screen.tsx,
  apps/web/components/settings/security-screen.tsx,
  apps/web/lib/audit/index.ts,
  apps/web/lib/env.ts,
  apps/web/lib/security/rate-limit.ts,
  apps/web/lib/security/password-policy.ts,
  apps/web/lib/payroll/calc.ts,
  apps/web/lib/requests/leave-math.ts,
  apps/web/lib/payroll/calc.test.ts,
  apps/web/lib/requests/leave-math.test.ts,
  apps/web/lib/attendance/time.test.ts,
  apps/web/lib/security/rate-limit.test.ts,
  apps/web/lib/security/password-policy.test.ts,
  apps/web/lib/env.test.ts,
  apps/web/lib/rbac/rbac.test.ts
```
