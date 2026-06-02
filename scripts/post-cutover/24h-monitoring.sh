#!/usr/bin/env bash
#
# 24h-monitoring.sh — мониторинг первых 24 часов после cutover (план Iteration 10, «Post-cutover»).
# Один проход проверок (cron-friendly: планировать каждые 30 мин на 24 ч; либо LOOP=1 — самоцикл).
# Пороги соответствуют мониторам Iteration 7 (server/src/services/observability/monitors.ts):
#   - uptime:        GET /api/health/live=200 и /api/health/ready=200 (все зависимости ok);
#   - DB conn:       count(pg_stat_activity usename=billhub_runtime) ≤ conn_limit*0.8 (24 из 30);
#   - dead jobs:     jobs_log status='dead' за 1 ч == 0;
#   - monitor-алерты: audit_log событий db_connections_high/dead_jobs_detected/s3_error_rate_high за 1 ч == 0;
#   - error_logs:    рост error_logs за окно ≤ порога;
#   - retention:     партиция audit_log текущего месяца существует (партиционирование живо).
#
# Только чтение (psql SELECT + curl health). Идемпотентно. Любой ALERT → exit !=0 (ловит cron/алертинг).
#
# Переменные окружения:
#   MONITOR_DATABASE_URL  read-подключение к Yandex PG (по умолчанию DATABASE_URL)      [обязательна]
#   HEALTH_BASE_URL       база для /api/health (https://billhub.example)               [обязательна]
#   CONN_LIMIT            conn_limit billhub_runtime (по умолчанию 30, ADR-0005)
#   CONN_RATIO           доля для алерта (по умолчанию 0.8 → порог 24)
#   ERROR_LOG_WINDOW_MIN  окно error_logs в минутах (по умолчанию 30)
#   ERROR_LOG_THRESHOLD   порог числа error_logs за окно (по умолчанию 50)
#   LOOP / LOOP_INTERVAL  LOOP=1 — самоцикл каждые LOOP_INTERVAL сек (по умолчанию 1800) в течение 24 ч
#   DRY_RUN               1 — печатать намерения
#
# Выход: 0 — все проверки PASS; !=0 — есть ALERT.

set -euo pipefail

CUTOVER_SCRIPT_NAME="24h-monitoring"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"
# shellcheck disable=SC2034
CUTOVER_REPO_ROOT="$repo_root"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=../cutover/lib/common.sh
source "$here/../cutover/lib/common.sh"

MONITOR_DATABASE_URL="${MONITOR_DATABASE_URL:-${DATABASE_URL:-}}"
CONN_LIMIT="${CONN_LIMIT:-30}"
CONN_RATIO="${CONN_RATIO:-0.8}"
ERROR_LOG_WINDOW_MIN="${ERROR_LOG_WINDOW_MIN:-30}"
ERROR_LOG_THRESHOLD="${ERROR_LOG_THRESHOLD:-50}"
LOOP_INTERVAL="${LOOP_INTERVAL:-1800}"

ALERTS=()
alert() { ALERTS+=("$1"); printf '  ⚠ ALERT: %s\n' "$1"; }
ok()    { printf '  ✓ %s\n' "$1"; }

psql_val() { psql "$MONITOR_DATABASE_URL" -tAc "$1" 2>/dev/null | tr -d '[:space:]'; }
http_code() { curl -ksS -o /dev/null -w '%{http_code}' --max-time 10 "$1"; }

check_uptime() {
  local live ready
  live="$(http_code "$HEALTH_BASE_URL/api/health/live")"
  ready="$(http_code "$HEALTH_BASE_URL/api/health/ready")"
  if [[ "$live" == "200" ]]; then ok "uptime: /health/live=200"; else alert "uptime: /health/live=$live (ожидался 200)"; fi
  if [[ "$ready" == "200" ]]; then ok "uptime: /health/ready=200"; else alert "uptime: /health/ready=$ready (зависимость не готова)"; fi
}

check_db_conn() {
  local active threshold
  active="$(psql_val "SELECT count(*) FROM pg_stat_activity WHERE usename='billhub_runtime'")"
  [[ -n "$active" ]] || { alert "db conn: не удалось прочитать pg_stat_activity"; return; }
  threshold="$(awk "BEGIN{printf \"%d\", $CONN_LIMIT*$CONN_RATIO}")"
  if (( active > threshold )); then alert "db conn: $active > $threshold (>${CONN_RATIO} от conn_limit $CONN_LIMIT)"; else ok "db conn: $active ≤ $threshold"; fi
}

check_dead_jobs() {
  local dead
  dead="$(psql_val "SELECT count(*) FROM jobs_log WHERE status='dead' AND created_at > now() - interval '1 hour'")"
  [[ -n "$dead" ]] || { alert "dead jobs: не удалось прочитать jobs_log"; return; }
  if (( dead > 0 )); then alert "dead jobs: $dead за последний час (>0)"; else ok "dead jobs: 0 за час"; fi
}

check_monitor_alerts() {
  local n
  n="$(psql_val "SELECT count(*) FROM audit_log WHERE event_type IN ('db_connections_high','dead_jobs_detected','s3_error_rate_high') AND created_at > now() - interval '1 hour'")"
  [[ -n "$n" ]] || { alert "monitor-алерты: не удалось прочитать audit_log"; return; }
  if (( n > 0 )); then alert "monitor-алерты в audit_log: $n за час (conn/dead/S3) — разберите"; else ok "monitor-алертов в audit_log нет"; fi
}

check_error_logs() {
  local n
  n="$(psql_val "SELECT count(*) FROM error_logs WHERE created_at > now() - interval '$ERROR_LOG_WINDOW_MIN minutes'")"
  [[ -n "$n" ]] || { alert "error_logs: не удалось прочитать"; return; }
  if (( n > ERROR_LOG_THRESHOLD )); then alert "error_logs: $n за ${ERROR_LOG_WINDOW_MIN}мин (> порога $ERROR_LOG_THRESHOLD)"; else ok "error_logs: $n за ${ERROR_LOG_WINDOW_MIN}мин (≤ $ERROR_LOG_THRESHOLD)"; fi
}

check_retention() {
  # Партиция audit_log текущего месяца должна существовать (retention/обслуживание партиций живо).
  local part exists
  part="audit_log_$(date +%Y_%m 2>/dev/null || echo '')"
  [[ -n "$part" && "$part" != "audit_log_" ]] || { ok "retention: проверка партиции пропущена (нет date)"; return; }
  exists="$(psql_val "SELECT to_regclass('public.$part') IS NOT NULL")"
  if [[ "$exists" == "t" ]]; then ok "retention: партиция $part существует"; else alert "retention: партиция $part отсутствует — обслуживание партиций audit_log не отработало"; fi
}

run_pass() {
  ALERTS=()
  log "--- проверка $(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo now) ---"
  check_uptime
  check_db_conn
  check_dead_jobs
  check_monitor_alerts
  check_error_logs
  check_retention
  if (( ${#ALERTS[@]} == 0 )); then
    log "PASS: все проверки в норме."
    return 0
  fi
  log "ALERT: ${#ALERTS[@]} проблем — уведомите incident-команду (см. runbook-incident-response.md)."
  return 1
}

main() {
  init_logging
  require_env MONITOR_DATABASE_URL
  require_env HEALTH_BASE_URL
  assert_not_supabase "$MONITOR_DATABASE_URL" "MONITOR_DATABASE_URL"
  log "=== POST-CUTOVER: мониторинг первых 24 часов ==="

  if [[ "$DRY_RUN" == "1" ]]; then
    log "[dry-run] Один проход: uptime + db conn (порог $(awk "BEGIN{printf \"%d\", $CONN_LIMIT*$CONN_RATIO}")) + dead jobs + monitor-алерты + error_logs + retention."
    log "[dry-run] Проверки не выполнялись."
    exit 0
  fi

  require_cmd psql
  require_cmd curl

  if [[ "${LOOP:-0}" == "1" ]]; then
    local end; end=$(( $(date +%s) + 86400 ))
    local rc=0
    while (( $(date +%s) < end )); do
      run_pass || rc=1
      (( $(date +%s) + LOOP_INTERVAL < end )) || break
      sleep "$LOOP_INTERVAL"
    done
    exit "$rc"
  fi

  run_pass
}

main "$@"
