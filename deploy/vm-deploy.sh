#!/usr/bin/env bash
# Runs ON THE VM (invoked by .github/workflows/deploy.yml over SSH, or by
# hand). Mirrors docs/DEPLOYMENT.md § 11 with the fixes found doing this
# manually:
#   - `bun install`'s postinstall (`prisma generate`) hangs on this VM ->
#     run it separately via npx after install instead.
#   - restart via systemd, not PM2.
set -euo pipefail

REPO_DIR="/home/pruthvirajsinh_biz/pikorua-hrm"
export PATH="$HOME/.bun/bin:$PATH"

cd "$REPO_DIR"

git pull

# Skip postinstall's `prisma generate` (hangs under bun on this VM) and run
# it via npx afterward instead.
bun install --frozen-lockfile --ignore-scripts
npx prisma generate

bun run prisma:deploy
bun run build

sudo systemctl restart hrm

echo "Deployed $(git rev-parse --short HEAD)"
