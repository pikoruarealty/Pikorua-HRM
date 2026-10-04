#!/usr/bin/env bash
# Run as the VPS deploy user after `docker load`. Requires passwordless sudo
# for nginx -t/reload and ownership of /opt/pikorua-hrm. See DEPLOYMENT.md.
set -Eeuo pipefail

image="${1:?pass the immutable pikorua-hrm:<40-character-sha> image tag}"
[[ "$image" =~ ^pikorua-hrm:[a-f0-9]{40}$ ]] || { echo "Invalid image tag" >&2; exit 2; }
app_dir=/opt/pikorua-hrm
state="$app_dir/active-slot"
proxy="$app_dir/proxy.conf"
env_file="$app_dir/app.env"
uploads="$app_dir/uploads"
exec 9>"$app_dir/deploy.lock"
flock -n 9 || { echo "Another deployment is running" >&2; exit 1; }
test -f "$env_file"
test -d "$uploads"
docker image inspect "$image" >/dev/null
base_url="$(sed -n 's/^APP_BASE_URL=//p' "$env_file" | tail -n 1)"
scheme="${base_url%%://*}"
host_header="${base_url#*://}"
host_header="${host_header%%/*}"
test -n "$host_header"

old_slot="$(cat "$state" 2>/dev/null || true)"
if [[ "$old_slot" == blue ]]; then
  slot=green; port=3002; old_port=3001
else
  slot=blue; port=3001; old_port=3002
fi
new_name="pikorua-$slot"
old_name="pikorua-$old_slot"
old_image=""
if [[ "$old_slot" == blue || "$old_slot" == green ]]; then
  old_image="$(docker inspect -f '{{.Config.Image}}' "$old_name")"
fi

proxy_changed=false
rollback() {
  status=$?
  if (( status != 0 )); then
    if [[ "$proxy_changed" == true ]]; then
      if [[ "$old_slot" == blue || "$old_slot" == green ]]; then
        printf 'proxy_pass http://127.0.0.1:%s;\n' "$old_port" > "$proxy"
        sudo nginx -t && sudo systemctl reload nginx
        printf '%s\n' "$old_slot" > "$state"
      fi
    fi
    docker rm -f "$new_name" >/dev/null 2>&1 || true
    echo "Deployment failed; prior slot remains active" >&2
  fi
}
trap rollback EXIT

# Migrate before starting the new app. Migrations must be backward compatible
# with the still-running old container; this is checked in code review.
docker run --rm --network host --env-file "$env_file" \
  --entrypoint bun "$image" /app/node_modules/prisma/build/index.js migrate deploy --schema /app/prisma/schema.prisma

docker rm -f "$new_name" >/dev/null 2>&1 || true
docker run -d --name "$new_name" --restart unless-stopped --network host \
  --env-file "$env_file" -e "PORT=$port" -e SCHEDULER_ENABLED=false \
  -v "$uploads:/app/apps/web/uploads" "$image" >/dev/null

healthy=false
for _ in {1..30}; do
  if curl --fail --silent --max-time 3 "http://127.0.0.1:$port/api/health" | grep -q '"status":"ok"'; then
    healthy=true; break
  fi
  sleep 2
done
if [[ "$healthy" != true ]]; then
  docker logs --tail 80 "$new_name" >&2 || true
  exit 1
fi

printf 'proxy_pass http://127.0.0.1:%s;\n' "$port" > "$proxy.new"
mv "$proxy.new" "$proxy"
proxy_changed=true
sudo nginx -t
sudo systemctl reload nginx
printf '%s\n' "$slot" > "$state"

# Check through nginx after switching while the old app is still alive.
# Once certbot has set up HTTPS, nginx's port-80 server only answers with a 301
# redirect (no body), so a plain-HTTP check can never see the health JSON and
# would fail every release (it did, 2026-10-04). Probe the way real users reach
# the site: HTTPS to this host, pinned to the local nginx with --resolve. -k
# because this check asks "does nginx route to the new slot?", not "is the
# certificate valid?" — an expiring cert is certbot's/monitoring's problem and
# must not block (or roll back) an otherwise healthy release.
if [[ "$scheme" == https ]]; then
  check_url="https://$host_header/api/health"
  check_args=(--insecure --resolve "$host_header:443:127.0.0.1")
else
  check_url="http://127.0.0.1/api/health"
  check_args=(-H "Host: $host_header")
fi
via_nginx=false
response=""
for _ in {1..5}; do
  response="$(curl --silent --max-time 10 "${check_args[@]}" -w '\nHTTP %{http_code}' "$check_url" || true)"
  if grep -q '"status":"ok"' <<<"$response"; then via_nginx=true; break; fi
  sleep 2
done
if [[ "$via_nginx" != true ]]; then
  # --silent used to hide why this failed; say what nginx actually answered.
  echo "Health check through nginx failed: $check_url" >&2
  printf '%s\n' "$response" >&2
  exit 1
fi

if [[ "$old_slot" == blue || "$old_slot" == green ]]; then
  docker rm -f "$old_name" >/dev/null
  if [[ "$old_image" != "$image" ]]; then docker image rm "$old_image" >/dev/null || true; fi
fi
proxy_changed=false
trap - EXIT
echo "Deployed $image on $slot ($port)"
