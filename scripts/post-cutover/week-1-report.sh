#!/usr/bin/env bash
#
# week-1-report.sh — отчёт за первую неделю после cutover (план Iteration 10, «Post-cutover»).
# Собирает read-only агрегаты из Yandex PG в markdown-отчёт для incident-команды (ежедневный/итоговый).
#
# Разделы: audit_log по типам событий (login/refresh/password/role/admin + monitor-алерты),
# jobs_log (всего/по статусам/средняя длительность/dead), error_logs (всего за 7д), текущие соединения,
# обслуживание партиций audit_log, backlog outbox. Только SELECT — прод не модифицируется.
#
# Идемпотентно: перегенерирует отчёт (перезапись REPORT_OUT).
#
# Переменные окружения:
#   MONITOR_DATABASE_URL  read-подключение к Yandex PG (по умолчанию DATABASE_URL)      [обязательна]
#   REPORT_OUT            путь отчёта (по умолчанию docs/cutover-artifacts/week-1-report.md)
#   REPORT_DAYS           окно отчёта в днях (по умолчанию 7)
#   DRY_RUN               1 — печатать намерения, не подключаться к БД
#
# Выход: 0 — отчёт сформирован; !=0 — ошибка чтения БД.

set -euo pipefail

CUTOVER_SCRIPT_NAME="week-1-report"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"
# shellcheck disable=SC2034
CUTOVER_REPO_ROOT="$repo_root"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=../cutover/lib/common.sh
source "$here/../cutover/lib/common.sh"

MONITOR_DATABASE_URL="${MONITOR_DATABASE_URL:-${DATABASE_URL:-}}"
REPORT_OUT="${REPORT_OUT:-$repo_root/docs/cutover-artifacts/week-1-report.md}"
REPORT_DAYS="${REPORT_DAYS:-7}"

# psql: вернуть строки запроса (markdown-таблица из колонок через ' | ').
psql_rows() { psql "$MONITOR_DATABASE_URL" -tA -F ' | ' -c "$1" 2>/dev/null; }
psql_val()  { psql "$MONITOR_DATABASE_URL" -tAc "$1" 2>/dev/null | tr -d '[:space:]'; }

main() {
  init_logging
  require_env MONITOR_DATABASE_URL
  assert_not_supabase "$MONITOR_DATABASE_URL" "MONITOR_DATABASE_URL"
  log "=== POST-CUTOVER: отчёт за первую неделю (окно ${REPORT_DAYS}д) → $REPORT_OUT ==="

  if [[ "$DRY_RUN" == "1" ]]; then
    log "[dry-run] SELECT-агрегаты audit_log/jobs_log/error_logs/pg_stat_activity/outbox за ${REPORT_DAYS}д → $REPORT_OUT"
    log "[dry-run] Отчёт не формировался."
    exit 0
  fi

  require_cmd psql
  local now; now="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo 'now')"
  mkdir -p "$(dirname "$REPORT_OUT")"

  local audit jobs_by_status jobs_total dead_total avg_dur err_total conn outbox_backlog parts
  audit="$(psql_rows "SELECT event_type, count(*) FROM audit_log WHERE created_at > now() - interval '$REPORT_DAYS days' GROUP BY event_type ORDER BY count(*) DESC")"
  jobs_by_status="$(psql_rows "SELECT status, count(*) FROM jobs_log WHERE created_at > now() - interval '$REPORT_DAYS days' GROUP BY status ORDER BY count(*) DESC")"
  jobs_total="$(psql_val "SELECT count(*) FROM jobs_log WHERE created_at > now() - interval '$REPORT_DAYS days'")"
  dead_total="$(psql_val "SELECT count(*) FROM jobs_log WHERE status='dead' AND created_at > now() - interval '$REPORT_DAYS days'")"
  avg_dur="$(psql_val "SELECT COALESCE(round(avg(duration_ms)),0) FROM jobs_log WHERE created_at > now() - interval '$REPORT_DAYS days'")"
  err_total="$(psql_val "SELECT count(*) FROM error_logs WHERE created_at > now() - interval '$REPORT_DAYS days'")"
  conn="$(psql_val "SELECT count(*) FROM pg_stat_activity WHERE usename='billhub_runtime'")"
  outbox_backlog="$(psql_val "SELECT count(*) FROM outbox WHERE processed_at IS NULL")"
  parts="$(psql_rows "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'audit_log_%' ORDER BY tablename")"

  {
    printf '# Week-1 post-cutover report\n\n'
    printf '**Сформирован:** %s · **Окно:** последние %s дней · **БД:** %s\n\n' "$now" "$REPORT_DAYS" "$(db_host "$MONITOR_DATABASE_URL")"
    printf '> Read-only агрегаты Yandex PG (план Iteration 10, Post-cutover). Источник порогов — мониторы Iteration 7.\n\n'

    printf '## Сводка\n\n'
    printf '| Метрика | Значение |\n|---|---|\n'
    printf '| jobs_log всего | %s |\n' "${jobs_total:-?}"
    printf '| jobs_log dead | %s |\n' "${dead_total:-?}"
    printf '| jobs_log средняя длительность (мс) | %s |\n' "${avg_dur:-?}"
    printf '| error_logs всего | %s |\n' "${err_total:-?}"
    printf '| соединения billhub_runtime сейчас | %s |\n' "${conn:-?}"
    printf '| outbox backlog (processed_at IS NULL) | %s |\n\n' "${outbox_backlog:-?}"

    printf '## audit_log по типам событий\n\n| event_type | count |\n|---|---|\n'
    if [[ -n "$audit" ]]; then printf '%s\n' "$audit" | sed -E 's/^/| /; s/ \| /| /; s/$/ |/'; else printf '| _нет событий_ | 0 |\n'; fi
    printf '\n'

    printf '## jobs_log по статусам\n\n| status | count |\n|---|---|\n'
    if [[ -n "$jobs_by_status" ]]; then printf '%s\n' "$jobs_by_status" | sed -E 's/^/| /; s/ \| /| /; s/$/ |/'; else printf '| _нет задач_ | 0 |\n'; fi
    printf '\n'

    printf '## Партиции audit_log (обслуживание партиционирования)\n\n'
    if [[ -n "$parts" ]]; then printf '%s\n' "$parts" | sed -E 's/^/- /'; else printf '_партиций audit_log_* не найдено — проверьте retention_\n'; fi
    printf '\n'

    printf '## Выводы (заполнить вручную)\n\n'
    printf -- '- Производительность OCR vs pre-cutover: <заполнить>\n'
    printf -- '- Инциденты за неделю: <заполнить>\n'
    printf -- '- Решение по отключению старой инфры (после 30д): <заполнить>\n'
  } > "$REPORT_OUT"

  log "ГОТОВО. Отчёт: $REPORT_OUT (jobs=$jobs_total, dead=$dead_total, errors=$err_total, outbox_backlog=$outbox_backlog)."
}

main "$@"
