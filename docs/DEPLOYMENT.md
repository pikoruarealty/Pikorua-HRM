# Production deployment: Hostinger VPS (migrated from GCP on 2026-10-04)

**Production is the Hostinger VPS.** The HRM was moved from the GCP VM on 2026-10-04; the GCP HRM service (`hrm`) is stopped and disabled (confirmed 2026-10-04), so a reboot of that VM cannot restart it and run duplicate jobs. The former GCP installation guide is preserved in [DEPLOYMENT_GCP_LEGACY.md](DEPLOYMENT_GCP_LEGACY.md) for history only. The layout: one Hostinger Ubuntu 26.04 VPS, host PostgreSQL 17, host nginx and cron, and one Dockerized Next.js app. GitHub Actions builds and tests the image; the VPS only loads and runs it. Sections 1 to 3 below are the preparation and migration runbook (kept so the move can be repeated or audited); section 4 is the routine release process.

## Production status (as built)

| Item | Value |
|---|---|
| Public URL | `https://hrm.pikoruarealty.com` (A record to `187.126.115.164`; it was a CNAME to `adflow.pikoruarealty.com` on GCP, with a ~1h TTL) |
| VPS | Ubuntu 26.04, shared with other Pikorua apps (the CRM stack in `/opt/pikorua-crm`, the `pikorua-live-*` stack). nginx on the host owns 80/443; the HRM is one extra site, `/etc/nginx/sites-enabled/pikorua-hrm.conf`, which certbot edited to add HTTPS and a redirect |
| App | Docker container `pikorua-blue` or `pikorua-green` (port 3001/3002, loopback only), `--network host`, state in `/opt/pikorua-hrm/active-slot` |
| Config | `/opt/pikorua-hrm/app.env` (mode 600, owner `deploy_hrm`, unquoted `KEY=value`). `AUTH_SECRET` and every other server secret were carried over unchanged from GCP, so sessions survived the move. `NEXT_PUBLIC_*` values are GitHub repository **variables** |
| Database | Host PostgreSQL **17.11**, database `pikorua_hrm`, role `pikorua`, listens on localhost only. The password is only in `app.env` |
| Uploads | `/opt/pikorua-hrm/uploads` (bind-mounted to `/app/apps/web/uploads`), owned by UID 1000. UID 1000 is also a normal login user on this host, so that user can read employee documents |
| Deploy user | `deploy_hrm` (Docker group; sudo only for `nginx -t` and `systemctl reload nginx`) |
| Cron | `/etc/cron.d/pikorua-hrm`, run as `deploy_hrm`, UTC server clock. The workflow ships `hostinger-cron.sh` but **not** the cron file, so a rebuilt VPS needs `deploy/hostinger.cron` installed by hand |
| Releases | `DEPLOY_TARGET=hostinger`. The `gcp` job in `deploy.yml` still exists but the `DEPLOY_*` secrets now point at the VPS, so **do not set `DEPLOY_TARGET=gcp`** without recreating the GCP secrets |

Known gaps and decisions at the time of the move:

- **CRM sync does not work yet.** The CRM allowlists caller IPs in its `HRM_ALLOWED_IPS` setting (an env file in `/opt/pikorua-crm/secrets/`), and it still lists only the old GCP IP `34.14.190.134`. `crm.pikoruarealty.com` currently resolves to a different, older CRM host (8.232.21.212), which returns 401 "Invalid HRM API authorization" to HRM. The HRM key itself is correct (hash matches the CRM's). Fix: the CRM owner adds `187.126.115.164` (confirm the VPS's real outbound IP with `curl https://ifconfig.me`) on whichever CRM server `crm.pikoruarealty.com` points to; if the CRM moves onto this VPS, the address it sees for HRM may differ, so read its log for the rejected IP. No HRM change is needed; the next hourly `crm-sync` recovers, and each run re-pulls today plus the previous two days.
- **Backups:** only Hostinger's weekly whole-VPS snapshot exists. There is **no** nightly database dump or upload copy, so up to a week of data (and payroll inputs) could be lost, and a snapshot of a running PostgreSQL is only crash-consistent. A nightly encrypted `pg_dump` + uploads archive copied off the VPS is still recommended (see section 4).
- **A temporary SSH key** (`xfer-temp`, restricted by `from=` to the GCP IP) remains in `/home/deploy_hrm/.ssh/authorized_keys` and `~/xfer_key` on GCP, kept on purpose for another project's migration. Delete it on both sides when that is done.
- **GCP VM keeps running** and hosts `adflow.pikoruarealty.com`; only its HRM service (`hrm`) is stopped. Do not delete the VM on account of the HRM move.
- **Postgres 17, not 16.** Ubuntu 26.04 showed no installable `postgresql-16` candidate, and a dump taken on 17 cannot be restored into 16. CI and `deploy.yml` test against `postgres:17` to match production.

## Why this layout

- App slots use ports 3001 (blue) and 3002 (green), bound to host loopback. Nginx reads `/opt/pikorua-hrm/proxy.conf`; the deploy script changes that file and reloads nginx only after the candidate passes `/api/health`. It retains the old container until a check through nginx passes. A failed candidate is removed and traffic stays on, or returns to, the old slot.
- Both containers set `SCHEDULER_ENABLED=false`. Host cron calls the `CRON_SECRET` routes against **only the active port**. This avoids duplicate TeamOffice, CRM, attendance, reminder and rollover jobs while slots overlap. The login rate limiter remains in memory; its short window resets on a deployment.
- PostgreSQL is installed on the host, not in another Docker image. The upload directory is a persistent bind mount shared across slots. The image contains code, dependencies and Prisma migrations, but no production secrets or user data.
- `deploy/hostinger-preflight.sh` removes an unused candidate image before the next transfer. The successful deploy removes the old container and image. Thus the VPS keeps at most the active and candidate **application** images during a deployment, then one. Docker's base layers are shared. The database and uploads are separate persistent storage.

## 1. Prepare Hostinger before any cutover

Use an Ubuntu VPS with enough free disk for two ~362 MB app images, PostgreSQL, uploads and backups. Install Docker Engine, PostgreSQL 17 (from the PGDG apt repo; Ubuntu 26.04 does not ship 16, and the GCP source is 17.11 — a dump cannot be restored into an older major), nginx, cron and certbot. Set DNS TTL low on the existing HRM record in advance. Open 80/443 and a restricted SSH port; block 3001, 3002 and 5432 externally. Keep the current GCP deployment running until the data copy and validation.

Create a deploy user named `deploy_hrm` with Docker access and limited passwordless sudo for `nginx -t` and `systemctl reload nginx`. Docker group membership grants root-equivalent host access, so protect this account and its SSH key. Create `/opt/pikorua-hrm`, owned by that user, with `/opt/pikorua-hrm/uploads` owned by UID 1000 (the image's `bun` user), mode 750. Keep `/opt/pikorua-hrm/app.env` mode 600. Use ordinary unquoted `KEY=value` lines because Docker `--env-file` reads them literally; do not copy `.env.example` with quoted values directly. Include at least:

```text
DATABASE_URL=postgresql://pikorua:...@127.0.0.1:5432/pikorua_hrm?schema=public
AUTH_SECRET=...
CRON_SECRET=...
APP_BASE_URL=https://hrm.pikoruarealty.com
GROQ_API_KEY=...
GROQ_MODEL=...
CRM_API_BASE_URL=...
CRM_API_KEY=...
BREVO_API_KEY=...
FIREBASE_ADMIN_PROJECT_ID=...
FIREBASE_ADMIN_CLIENT_EMAIL=...
FIREBASE_ADMIN_PRIVATE_KEY=...
TEAM_OFFICE_CORPORATE_ID=...
TEAM_OFFICE_USERNAME=...
TEAM_OFFICE_PASSWORD=...
```

Copy all other used production variables from GCP, particularly CRM credentials and email settings. Preserve the **same** `AUTH_SECRET` through the move so existing sessions can validate. Rotate credentials only as a separate planned step. Put public `NEXT_PUBLIC_*` values in GitHub Actions repository **variables**, since Next embeds these at image build time. A changed public value needs a new image. The server-only values stay solely in `app.env` on the VPS.

Create the `pikorua_hrm` database and `pikorua` role on host PostgreSQL 17. PostgreSQL can listen on localhost because containers use `--network host`; require password auth for that role. Do not seed this production database. The image migration command uses the same `DATABASE_URL` and `prisma migrate deploy` as CI.

Install `deploy/hostinger-nginx.conf` as the nginx site (edit `server_name` if the real HRM domain differs) and set `/opt/pikorua-hrm/proxy.conf` initially to `proxy_pass http://127.0.0.1:3001;`. Run `nginx -t`. The site will return 502 until the first app deploy. Obtain a Let's Encrypt certificate after DNS points to the VPS; use certbot's nginx integration and verify renewal. Nginx must overwrite `X-Forwarded-For` as this config does, because audit and login throttling use it.

Install `deploy/hostinger.cron` at `/etc/cron.d/pikorua-hrm` (root owned, mode 644); ensure the `deploy_hrm` user has `/opt/pikorua-hrm/hostinger-cron.sh` executable. Cron uses UTC for daily jobs, matching the former in-process scheduler, and checks Asia/Kolkata hours for TeamOffice. **Install cron only once the first container is active.**

## 2. Configure GitHub Actions

The existing CI workflow still runs migrations, seed, typecheck, lint, tests and a Next production build on GitHub. After a successful **push to main**, `deploy.yml` checks out that exact commit, builds the final image, applies migrations from the image to a temporary PostgreSQL service, starts the image and checks `/api/health`. It then copies only the deployment scripts and `docker save` stream over SSH. No checkout, package install, Docker build or test runs on the VPS.

The repository variable `DEPLOY_TARGET` selects exactly one path after successful main CI: `gcp` invokes the old VM deploy script; `hostinger` builds/tests/transfers the Docker image. An unset or different value (for example `none`) deploys nowhere. It is now `hostinger`. During the migration it was `gcp`, then `none` while the VPS was prepared, then `hostinger` only after the data was restored. The `DEPLOY_*` secrets are shared by both jobs, so they now point at the VPS and the `gcp` path cannot work without recreating them.

For Hostinger, set GitHub Actions secrets `DEPLOY_HOST` (VPS address), `DEPLOY_USER` (`deploy_hrm`), `DEPLOY_SSH_KEY` (dedicated key), and `DEPLOY_SSH_KNOWN_HOSTS` (the VPS public SSH host key line, verified out of band). Set `NEXT_PUBLIC_APP_NAME` and Firebase `NEXT_PUBLIC_*` repository variables if those features are enabled. The deploy account must own `/opt/pikorua-hrm` and have the sudo permissions above. The workflow intentionally does not deploy a PR or an unrelated repository's run.

## 3. One-time production data move

*Completed 2026-10-04, after a rehearsal.* The data was small (12 MB database, 33 upload files), so the procedure was: restore a snapshot onto the VPS while GCP kept serving, deploy and test through an SSH tunnel, then repeat as the real move (stop GCP, final dump, drop and recreate the VPS database, restore, replace the uploads folder, verify per-table row counts and the upload file count are identical, install cron, switch DNS, `certbot --nginx`). Practical lessons: the GCP browser-SSH login user can differ between sessions and may not be able to read the app's home directory, so run `tar`/`find` on the uploads with `sudo` and check the archive is not 20 bytes before sending it; the app container must be stopped before `drop database ... with (force)`; and the three boot-time catch-up jobs the old in-process scheduler ran (`attendance-eod`, `birthday-check`, `crm-sync`) must be run once by hand after cutover with `sudo -u deploy_hrm /opt/pikorua-hrm/hostinger-cron.sh <job>`.

Schedule a maintenance window. First take a fresh **off-VM** backup of GCP PostgreSQL and `apps/web/uploads`, and verify the archive can be listed/read. Stop writes on GCP (`sudo systemctl stop hrm`, after confirming the service name), then make a final PostgreSQL custom-format dump and copy the upload tree. The current GCP deploy script uses `/home/pruthvirajsinh_biz/pikorua-hrm`; verify the real `WorkingDirectory` in `systemctl cat hrm` before copying. One workable sequence, run on GCP then transferring the two files over authenticated SSH, is:

```bash
sudo -u postgres pg_dump -Fc -d pikorua_hrm > /tmp/pikorua-final.dump
tar -C /home/pruthvirajsinh_biz/pikorua-hrm/apps/web -czf /tmp/pikorua-uploads.tar.gz uploads
sha256sum /tmp/pikorua-final.dump /tmp/pikorua-uploads.tar.gz
```

On Hostinger, compare the hashes and restore into an **empty** database before the first image deployment:

```bash
sudo -u postgres pg_restore --no-owner --no-acl --role=pikorua -d pikorua_hrm < /tmp/pikorua-final.dump
tar -C /opt/pikorua-hrm -xzf /tmp/pikorua-uploads.tar.gz
sudo chown -R 1000:1000 /opt/pikorua-hrm/uploads
```

If writes resume on GCP after the final dump, repeat the final copy; otherwise the two sites will diverge. Do not pass these archives through GitHub Actions or the Docker image.

Verify row counts for users, employees, work items, attendance records, point ledger and audit logs against GCP; compare upload file counts and representative hashes. Keep the source backup until the move is accepted. Run the first image deployment, which applies only pending committed Prisma migrations and checks the new app. Test login, attendance, task logging, payslip/PDF, document/photo reads, TeamOffice and CRM sync, cron, and a fresh backup on Hostinger before changing DNS. The CRM currently allowlists the GCP VM IP, so add the Hostinger outbound IP before testing CRM sync. Test through an SSH tunnel (`ssh -L 3001:127.0.0.1:3001 <user>@<vps>`, then browse `http://localhost:3001`): the session cookie is `Secure` in production, so login over plain HTTP to the VPS IP fails, but browsers accept Secure cookies on `localhost`. Port 3001 is the blue slot; use 3002 if green is active (`cat /opt/pikorua-hrm/active-slot`). Because DNS still points at GCP, a certificate cannot be issued over HTTP before cutover: run `certbot --nginx -d hrm.pikoruarealty.com` immediately after the DNS change (expect a short certificate-warning window), or issue it beforehand with a DNS-01 challenge. Then point DNS to Hostinger, issue/verify TLS, monitor errors and keep the old GCP app stopped to avoid diverging writes. Retain GCP data until its backups and the new site have been verified.

The first data move needs a write freeze because this project has one writable PostgreSQL database and local uploads, with no replication or dual-write path. Subsequent blue-green **app** releases do not need that freeze. Prisma migrations in app releases must be backward compatible with the old app during the overlap; destructive migrations need a separate staged release.

## 4. Routine release and rollback

On every successful main CI run, GitHub builds/tests/transfers the new image. `hostinger-deploy.sh` migrates, starts the inactive slot, waits for a healthy DB response, switches nginx, checks the response through nginx, then removes the old slot and image. A failed candidate leaves the old slot serving. The active image tag is the exact 40-character commit SHA in `/opt/pikorua-hrm/active-slot` and `docker inspect`; `docker ps --filter name=pikorua-` shows the current slot.

For an application rollback after a successful deploy, re-run the workflow for the desired known-good commit or transfer its image and call `hostinger-deploy.sh` with its immutable tag. The VPS deliberately does not retain a third old image; GitHub or an external image archive must supply it. **Database schema changes are not reversed automatically.** Restore a DB backup only for a separately planned data rollback.

Back up PostgreSQL and `/opt/pikorua-hrm/uploads` nightly to off-VPS storage, encrypt the backup, and test restore periodically. **Not yet in place:** only Hostinger's weekly VPS snapshot exists today (see "Production status"). Monitor `/api/health`, nginx, `docker logs pikorua-blue|green`, and cron output. Never run two in-process schedulers or expose the raw app ports publicly.
