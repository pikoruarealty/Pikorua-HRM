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

# One line per run in $app_dir/cron.log (UTC). Until 2026-10-07 this script threw
# every response away (>/dev/null) and a failure only went to cron's local mail,
# which nobody reads, so a stopped device-sync left no trace at all. Rolled once
# past 1 MB (cron.log.1 keeps the previous file). Never lets logging break the job.
log_file="$app_dir/cron.log"
log() { printf '%s %s %s\n' "$(date -u +%FT%TZ)" "$job" "$*" >> "$log_file" 2>/dev/null || true; }
if [[ -f "$log_file" ]] && (( $(stat -c %s "$log_file" 2>/dev/null || echo 0) > 1048576 )); then
  mv -f "$log_file" "$log_file.1" 2>/dev/null || true
fi

slot="$(cat "$app_dir/active-slot" 2>/dev/null || true)"
if [[ "$slot" != blue && "$slot" != green ]]; then
  log "SKIPPED: $app_dir/active-slot is '${slot}', expected blue or green"
  exit 0
fi
if [[ "$slot" == blue ]]; then port=3001; else port=3002; fi
cron_secret="$(sed -n 's/^CRON_SECRET=//p' "$app_dir/app.env" | tail -n 1)"
if [[ -z "$cron_secret" ]]; then
  log "FAILED: CRON_SECRET missing from $app_dir/app.env"
  exit 1
fi

body_file="$(mktemp)"
trap 'rm -f "$body_file"' EXIT
rc=0
code="$(curl --silent --show-error --max-time 110 -X POST -o "$body_file" -w '%{http_code}' \
  -H "Authorization: Bearer $cron_secret" \
  "http://127.0.0.1:$port/api/v1/cron/$job" 2>"$body_file.err")" || rc=$?
body="$(head -c 300 "$body_file" | tr '\n' ' ')"
err="$(head -c 300 "$body_file.err" 2>/dev/null | tr '\n' ' ')"
rm -f "$body_file.err"

if (( rc != 0 )); then
  log "FAILED: curl exit $rc on port $port ($slot): $err"
  exit 1
fi
if [[ "$code" != 2* ]]; then
  log "FAILED: HTTP $code on port $port ($slot): $body"
  exit 1
fi
log "ok HTTP $code port $port ($slot) $body"
