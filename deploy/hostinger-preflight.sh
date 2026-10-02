#!/usr/bin/env bash
# Clear a failed prior candidate before receiving the next image, keeping no
# more than the active app image plus the incoming app image on the VPS.
set -euo pipefail
app_dir=/opt/pikorua-hrm
exec 9>"$app_dir/deploy.lock"
flock -n 9 || exit 1
slot="$(cat "$app_dir/active-slot" 2>/dev/null || true)"
active=""
if [[ "$slot" == blue || "$slot" == green ]]; then
  active="$(docker inspect -f '{{.Config.Image}}' "pikorua-$slot")"
fi
while IFS= read -r tag; do
  [[ -z "$tag" || "$tag" == "$active" ]] && continue
  docker image rm "$tag" >/dev/null || true
done < <(docker image ls --format '{{.Repository}}:{{.Tag}}' 'pikorua-hrm:*')
