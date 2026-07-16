# Pikorua HRM — GCP VM Deployment Guide

> Companion to [README.md](../README.md) (local dev) and [API_SPEC.md](API_SPEC.md).
> Target: a single GCP Compute Engine VM running Postgres + the Next.js app behind nginx,
> matching the assumptions already baked into the codebase — see the callouts below.

**Read this first — two load-bearing assumptions in the code:**
1. **Single running server instance.** The in-process cron scheduler (`apps/web/instrumentation.ts`) and the login rate limiter (`lib/security/rate-limit.ts`) both hold state in memory. This guide deploys exactly one app process. If you ever horizontally scale, see the "Scaling beyond one instance" note at the end — don't just add a second VM/process without reading it.
2. **Local disk file storage.** Employee documents and profile photos live under `apps/web/uploads/` on the VM's disk (`lib/storage/local.ts`), not S3. Back this directory up (step 9).

---

## 1. Provision the VM

- **Machine**: e2-small or e2-medium is plenty for an internal HR tool (2 vCPU / 4GB RAM comfortably runs Postgres + Next.js for a small company).
- **OS**: Ubuntu 22.04 LTS.
- **Firewall**: allow inbound `80` and `443` (HTTP/HTTPS) from `0.0.0.0/0`, and `22` (SSH) restricted to your IP or via GCP's IAP tunnel. Do **not** expose `5432` (Postgres) or the app's raw port (`3000`) externally — everything public goes through nginx.
- **Static IP**: reserve an external static IP (GCP Console → VPC network → IP addresses) so DNS doesn't break on VM restart.
- **DNS**: point your domain (e.g. `hrm.pikorua.com`) at that static IP (an `A` record) before step 7 — certbot needs it resolvable.

SSH in for everything below:
```bash
gcloud compute ssh <instance-name> --zone <zone>
```

---

## 2. Install system dependencies

```bash
sudo apt-get update && sudo apt-get upgrade -y

# Node.js 20 (engines requires >=18.18.0; use 20 LTS)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Bun (this repo's package manager/runner — see root package.json scripts)
curl -fsSL https://bun.sh/install | bash
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
bun --version   # sanity check

# Postgres 16
sudo apt-get install -y postgresql postgresql-contrib

# nginx (reverse proxy + TLS termination)
sudo apt-get install -y nginx

# git, build tools
sudo apt-get install -y git build-essential

# PM2 (process manager — keeps the app running, restarts on crash/reboot)
sudo npm install -g pm2
```

---

## 3. Set up Postgres

```bash
sudo -u postgres psql
```
```sql
CREATE DATABASE pikorua_hrm;
CREATE USER pikorua WITH ENCRYPTED PASSWORD 'a-real-generated-password';
GRANT ALL PRIVILEGES ON DATABASE pikorua_hrm TO pikorua;
\q
```

Generate the password with `openssl rand -base64 24` — don't hand-type something guessable.

By default Postgres only listens on `localhost`, which is correct here (the app and DB run on the same VM). Leave `pg_hba.conf`/`postgresql.conf` at their defaults unless you have a specific reason to change them.

---

## 4. Clone the repo and install dependencies

```bash
sudo mkdir -p /opt/pikorua-hrm
sudo chown $USER:$USER /opt/pikorua-hrm
git clone https://github.com/<your-org>/<your-repo>.git /opt/pikorua-hrm
cd /opt/pikorua-hrm

bun install   # runs the root postinstall (`prisma generate`) automatically
```

---

## 5. Configure environment variables

```bash
cp .env.example .env
nano .env   # or vim/your editor of choice
```

Fill in **at minimum**:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgresql://pikorua:<password>@localhost:5432/pikorua_hrm?schema=public` |
| `AUTH_SECRET` | `openssl rand -base64 48` — long random string, **not** a placeholder. The server **refuses to boot in production** if this is missing, short, or contains a word like "change-me"/"example" (`lib/env.ts`) — this is intentional, don't try to bypass it. |
| `AUTH_SESSION_MAX_AGE` | `604800` (7 days) is a reasonable default |
| `CRON_SECRET` | `openssl rand -base64 32` — only matters if you later disable the in-process scheduler and call `/api/v1/cron/*` externally (see the "Scaling" note); still set it to something non-placeholder to silence the boot warning |
| `NEXT_PUBLIC_APP_NAME` | `"Pikorua HRM"` or your preferred display name |

**Optional** (leave blank to disable the feature — nothing else breaks):
- `GROQ_API_KEY` / `GROQ_MODEL` — AI task-generation feature. Get a key at console.groq.com.
- `NEXT_PUBLIC_FIREBASE_*`, `FIREBASE_ADMIN_*` — push notifications. See [README.md § Push notifications](../README.md) for the Firebase Console setup steps; all values are safe as `NEXT_PUBLIC_*` client config plus a service-account key for the `FIREBASE_ADMIN_*` ones. Missing values just mean push silently stays off — in-app notifications keep working regardless.
- `S3_*` — **unused**, left over from an earlier design (file storage was switched to local disk, see `lib/storage/local.ts`). Ignore these.

Lock down the file:
```bash
chmod 600 .env
```

---

## 6. Run migrations, seed, and build

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /opt/pikorua-hrm

bun run prisma:deploy     # applies all committed migrations (prisma migrate deploy — safe for prod, no schema drift prompts)
bun run db:seed           # OPTIONAL — only if you want the seeded demo accounts (admin@pikorua.test etc., password "Password123!"). Skip this for a real company deployment and create real accounts by hand once the app is up (see step 10), or write a one-off script.
bun run build              # full production build (apps/web/.next)
```

If you skip seeding, you'll need at least one Admin account to log in and create everyone else — see step 10.

---

## 7. Configure nginx + HTTPS (Let's Encrypt)

Create `/etc/nginx/sites-available/pikorua-hrm`:
```nginx
server {
    listen 80;
    server_name hrm.pikorua.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

`X-Forwarded-For` matters here specifically: `lib/audit/index.ts`'s `clientIp()` and the login rate limiter both trust the first hop of this header for the real client IP — this is safe *only* because nginx is the sole entry point and sets it itself, overwriting anything a client tries to spoof.

```bash
sudo ln -s /etc/nginx/sites-available/pikorua-hrm /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default   # remove the default nginx welcome page
sudo nginx -t   # test config
sudo systemctl reload nginx
```

Now get a real certificate:
```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d hrm.pikorua.com
```

Certbot rewrites the nginx config to add the `443` server block and redirect `80 → 443` automatically, and installs a systemd timer for auto-renewal. Confirm the timer exists:
```bash
systemctl list-timers | grep certbot
```

This is also the fix for the LAN self-signed-cert service-worker issue we hit earlier during push notification testing — a real Let's Encrypt cert is trusted by every browser out of the box, so push notifications will register cleanly here with no workarounds needed.

---

## 8. Run the app with PM2

```bash
cd /opt/pikorua-hrm/apps/web
pm2 start "bun run start" --name pikorua-hrm --cwd /opt/pikorua-hrm/apps/web
pm2 save
pm2 startup   # prints a command — copy/paste and run it to enable boot-time startup
```

`bun run start` runs `next start`, which serves the build from step 6 and boots `instrumentation.ts` — the in-process cron scheduler starts automatically, no separate cron setup needed (see the assumption at the top of this doc).

Useful PM2 commands:
```bash
pm2 logs pikorua-hrm       # tail logs — this is where the verbose [http]/[api]/[audit]/[fcm]/[cron] lines from lib/log land
pm2 restart pikorua-hrm    # after a deploy
pm2 status
```

---

## 9. Verify it's live

```bash
curl https://hrm.pikorua.com/api/health
# {"status":"ok","db":"up"}
```

Then in a browser: log in, confirm the dashboard loads, and check `pm2 logs` shows the `[cron] in-process scheduler started` line and no `[env] warning` about placeholder secrets.

**Back up regularly, both of these — losing either loses real data:**
- **Database**: `pg_dump pikorua_hrm | gzip > backup-$(date +%F).sql.gz`, cron this nightly to off-VM storage (GCS bucket, etc.). This is flagged as a known follow-up in `progress.md` — automate it, don't rely on remembering.
- **Uploads directory**: `/opt/pikorua-hrm/apps/web/uploads/` — employee documents and profile photos live here on local disk, not in the database or any cloud bucket. Include it in the same backup job.

---

## 10. First login / creating real accounts

If you skipped seeding (recommended for a real deployment), the `users` table is empty — you can't log in yet. Two ways to get a first Admin account:

**Option A — reuse the seed script's account, once, then delete the rest:**
```bash
bun run db:seed
```
Log in as `admin@pikorua.test` / `Password123!`, immediately change the password (Account Security → Change password), then either delete the other seeded demo employees from the UI or leave them if you want reference data — your call.

**Option B — insert one Admin row directly**, then create everyone else through the app's own "New employee" flow (Admin/HR only, requires a profile photo — see `docs/API_SPEC.md` §2):
```bash
cd /opt/pikorua-hrm
bunx prisma studio   # opens a local GUI on a random port — tunnel it or run this on your own machine against DATABASE_URL temporarily
```
Manually insert a `users` row with a bcrypt hash of your chosen password (`bcryptjs`, cost 10, matching `lib/auth/password.ts`) and `role = admin`. This is fiddlier than Option A but avoids any seeded demo data ever touching production.

---

## 11. Deploying updates

```bash
cd /opt/pikorua-hrm
git pull
bun install
bun run prisma:deploy   # applies any new migrations — safe, no-ops if there are none
bun run build
pm2 restart pikorua-hrm
```

Consider wiring this into the existing GitHub Actions CI (`.github/workflows/ci.yml`, which already runs migrate+seed+typecheck+lint+test+build on every push) as a deploy step later — e.g. an SSH action that runs the block above after CI passes on `main`. Not set up yet; this doc covers the manual path.

---

## Scaling beyond one instance

Don't do this without changing code first. Two in-memory assumptions break silently if you run more than one app process (a second VM, a second PM2 instance, a load balancer with >1 backend):

1. **Cron scheduler** (`instrumentation.ts` → `lib/cron/scheduler.ts`) — every instance would independently fire recognition snapshots, birthday checks, and meeting reminders, producing duplicate notifications. Fix: disable the in-process scheduler and instead hit the `CRON_SECRET`-gated routes from **one** external crontab (`POST /api/v1/cron/{recognition-snapshot,birthday-check,meeting-reminders}` with `Authorization: Bearer $CRON_SECRET`) — this path already exists and is documented in `README.md`.
2. **Login rate limiter** (`lib/security/rate-limit.ts`) — in-memory sliding window, so limits reset per-instance instead of being shared. Fix: swap for a Redis-backed limiter behind the same interface (the file's header comment flags this explicitly).

Neither is hard, but both need to happen together before you add a second instance — do it as one change, not incrementally.
