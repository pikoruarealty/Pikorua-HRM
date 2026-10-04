# Production deployment: GCP to Hostinger VPS

The current GCP VM is the source of truth until the one-time data migration and DNS cutover finish. Its former installation guide is preserved in [DEPLOYMENT_GCP_LEGACY.md](DEPLOYMENT_GCP_LEGACY.md). This guide describes the target: one Hostinger Ubuntu VPS, host PostgreSQL 17, host nginx and cron, and one Dockerized Next.js app. GitHub Actions builds and tests the image; the VPS only loads and runs it.

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
APP_BASE_URL=https://hrm.pikorua.com
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

The repository variable `DEPLOY_TARGET` selects exactly one path after successful main CI: `gcp` invokes the existing VM deploy script with the existing `DEPLOY_*` secrets; `hostinger` builds/tests/transfers the Docker image. An unset or different value deploys nowhere. Keep `DEPLOY_TARGET=gcp` while the GCP VM is live; change it to `hostinger` only after the VPS is prepared and production data is restored.

For Hostinger, set GitHub Actions secrets `DEPLOY_HOST` (VPS address), `DEPLOY_USER` (`deploy_hrm`), `DEPLOY_SSH_KEY` (dedicated key), and `DEPLOY_SSH_KNOWN_HOSTS` (the VPS public SSH host key line, verified out of band). Set `NEXT_PUBLIC_APP_NAME` and Firebase `NEXT_PUBLIC_*` repository variables if those features are enabled. The deploy account must own `/opt/pikorua-hrm` and have the sudo permissions above. The workflow intentionally does not deploy a PR or an unrelated repository's run.

## 3. One-time production data move

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

Verify row counts for users, employees, work items, attendance records, point ledger and audit logs against GCP; compare upload file counts and representative hashes. Keep the source backup until the move is accepted. Run the first image deployment, which applies only pending committed Prisma migrations and checks the new app. Test login, attendance, task logging, payslip/PDF, document/photo reads, TeamOffice and CRM sync, cron, and a fresh backup on Hostinger before changing DNS. The CRM currently allowlists the GCP VM IP, so add the Hostinger outbound IP before testing CRM sync. Test through a temporary hosts-file entry or the VPS IP with the correct Host header. Then point DNS to Hostinger, issue/verify TLS, monitor errors and keep the old GCP app stopped to avoid diverging writes. Retain GCP data until its backups and the new site have been verified.

The first data move needs a write freeze because this project has one writable PostgreSQL database and local uploads, with no replication or dual-write path. Subsequent blue-green **app** releases do not need that freeze. Prisma migrations in app releases must be backward compatible with the old app during the overlap; destructive migrations need a separate staged release.

## 4. Routine release and rollback

On every successful main CI run, GitHub builds/tests/transfers the new image. `hostinger-deploy.sh` migrates, starts the inactive slot, waits for a healthy DB response, switches nginx, checks the response through nginx, then removes the old slot and image. A failed candidate leaves the old slot serving. The active image tag is the exact 40-character commit SHA in `/opt/pikorua-hrm/active-slot` and `docker inspect`; `docker ps --filter name=pikorua-` shows the current slot.

For an application rollback after a successful deploy, re-run the workflow for the desired known-good commit or transfer its image and call `hostinger-deploy.sh` with its immutable tag. The VPS deliberately does not retain a third old image; GitHub or an external image archive must supply it. **Database schema changes are not reversed automatically.** Restore a DB backup only for a separately planned data rollback.

Back up PostgreSQL and `/opt/pikorua-hrm/uploads` nightly to off-VPS storage, encrypt the backup, and test restore periodically. Monitor `/api/health`, nginx, `docker logs pikorua-blue|green`, and cron output. Never run two in-process schedulers or expose the raw app ports publicly.
