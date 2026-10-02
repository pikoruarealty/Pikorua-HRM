#!/usr/bin/env bash
set -euo pipefail
job="${1:?job name required}"
case "$job" in
  device-sync|meeting-reminders|birthday-check|attendance-eod|daily-rollover|crm-sync|task-reminders) ;;
  *) exit 2 ;;
esac
if [[ "$job" == device-sync ]]; then
  hour="$(TZ=Asia/Kolkata date +%H)"
  (( 10#$hour >= 7 && 10#$hour <= 22 )) || exit 0
fi
app_dir=/opt/pikorua-hrm
slot="$(cat "$app_dir/active-slot" 2>/dev/null || true)"
[[ "$slot" == blue || "$slot" == green ]] || exit 0
if [[ "$slot" == blue ]]; then port=3001; else port=3002; fi
cron_secret="$(sed -n 's/^CRON_SECRET=//p' "$app_dir/app.env" | tail -n 1)"
test -n "$cron_secret"
curl --fail --silent --show-error --max-time 110 -X POST \
  -H "Authorization: Bearer $cron_secret" \
  "http://127.0.0.1:$port/api/v1/cron/$job" >/dev/null
