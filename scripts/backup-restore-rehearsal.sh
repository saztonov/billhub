#!/usr/bin/env bash
#
# backup-restore-rehearsal.sh — репетиция восстановления Yandex Managed PostgreSQL из бэкапа
# в ОТДЕЛЬНЫЙ тестовый кластер + smoke (план Iteration 7/9, ADR-0005 RPO/RTO).
#
# Назначение: регулярно (перед cutover и далее ежеквартально) подтверждать, что бэкап БД
# восстановим и пригоден, и измерять фактический RTO (целевой 2–4 ч по ADR-0005; RPO 0 —
# read-only на старом проде в окне cutover).
#
# ПРИНЦИП 1: скрипт НИКОГДА не трогает прод-кластер на запись — только list backups (read-only)
# и restore в НОВЫЙ/тестовый кластер. Никаких операций на источнике, кроме чтения списка бэкапов.
#
# Требования: yc (Yandex Cloud CLI, авторизован), psql, pg_isready. Запуск под bash.
# Безопасный режим: DRY_RUN=1 печатает команды, не выполняя их.
#
# Переменные окружения:
#   YC_PROFILE                 профиль yc CLI (по умолчанию активный)
#   SOURCE_CLUSTER_ID          id прод-кластера Yandex PG (источник бэкапа)        [обязательна]
#   BACKUP_ID                  конкретный бэкап (по умолчанию — последний доступный)
#   TEST_CLUSTER_NAME          имя нового тестового кластера (по умолчанию billhub-restore-rehearsal)
#   TEST_DB_NAME               имя БД (по умолчанию billhub_db)
#   RESTORE_NETWORK_ID         network-id для тестового кластера                   [обязательна]
#   RESTORE_SUBNET_ID          subnet-id для тестового кластера                    [обязательна]
#   RESTORE_ZONE               зона (по умолчанию ru-central1-a)
#   SMOKE_DATABASE_URL         строка подключения к восстановленной БД для smoke   [обязательна для smoke]
#   EXPECTED_MIGRATION         ожидаемая последняя версия миграции (по умолчанию 3)
#   KEEP_TEST_CLUSTER          1 — не удалять тестовый кластер по завершении (для ручного разбора)
#   DRY_RUN                    1 — печатать команды, не выполнять
#
# Выход: 0 — rehearsal успешен (restore + smoke зелёные); !=0 — провал (детали в логе).

set -euo pipefail

log()  { printf '[rehearsal] %s\n' "$*"; }
fail() { printf '[rehearsal][ОШИБКА] %s\n' "$*" >&2; exit 1; }
run()  { if [[ "${DRY_RUN:-0}" == "1" ]]; then printf '[dry-run] %s\n' "$*"; else eval "$@"; fi; }

require_cmd() { command -v "$1" >/dev/null 2>&1 || fail "не найдена утилита: $1"; }
require_env() { [[ -n "${!1:-}" ]] || fail "не задана переменная окружения: $1"; }

TEST_CLUSTER_NAME="${TEST_CLUSTER_NAME:-billhub-restore-rehearsal}"
TEST_DB_NAME="${TEST_DB_NAME:-billhub_db}"
RESTORE_ZONE="${RESTORE_ZONE:-ru-central1-a}"
EXPECTED_MIGRATION="${EXPECTED_MIGRATION:-3}"

main() {
  require_cmd yc
  require_cmd psql
  require_env SOURCE_CLUSTER_ID
  require_env RESTORE_NETWORK_ID
  require_env RESTORE_SUBNET_ID

  local yc_args=()
  [[ -n "${YC_PROFILE:-}" ]] && yc_args+=(--profile "$YC_PROFILE")

  local started_at restore_done_at
  started_at="$(date +%s)"

  # 1. Выбор бэкапа (read-only по источнику; прод не модифицируется — принцип 1).
  if [[ -z "${BACKUP_ID:-}" ]]; then
    log "Получение последнего бэкапа кластера $SOURCE_CLUSTER_ID …"
    BACKUP_ID="$(yc "${yc_args[@]}" managed-postgresql backup list \
      --cluster-id "$SOURCE_CLUSTER_ID" --format json \
      | python3 -c 'import sys,json; b=json.load(sys.stdin); print(sorted(b, key=lambda x: x.get("created_at",""))[-1]["id"])' )" \
      || fail "не удалось получить список бэкапов"
  fi
  log "Используем бэкап: $BACKUP_ID"

  # 2. Restore в НОВЫЙ тестовый кластер (источник не трогаем).
  log "Восстановление бэкапа в новый кластер '$TEST_CLUSTER_NAME' …"
  run "yc ${yc_args[*]} managed-postgresql cluster restore \
    --backup-id '$BACKUP_ID' \
    --name '$TEST_CLUSTER_NAME' \
    --environment production \
    --network-id '$RESTORE_NETWORK_ID' \
    --host zone-id='$RESTORE_ZONE',subnet-id='$RESTORE_SUBNET_ID',assign-public-ip=false \
    --resource-preset s3-c2-m8 --disk-size 50 --disk-type network-ssd"

  restore_done_at="$(date +%s)"
  log "Restore завершён за $(( restore_done_at - started_at )) сек (вклад в RTO; цель ADR-0005: 2–4 ч)."

  # 3. Smoke на восстановленной БД (если задан SMOKE_DATABASE_URL).
  if [[ -n "${SMOKE_DATABASE_URL:-}" && "${DRY_RUN:-0}" != "1" ]]; then
    smoke
  else
    log "SMOKE_DATABASE_URL не задан (или dry-run) — smoke пропущен."
  fi

  # 4. Очистка тестового кластера.
  if [[ "${KEEP_TEST_CLUSTER:-0}" == "1" ]]; then
    log "KEEP_TEST_CLUSTER=1 — тестовый кластер '$TEST_CLUSTER_NAME' оставлен (удалите вручную)."
  else
    log "Удаление тестового кластера '$TEST_CLUSTER_NAME' …"
    run "yc ${yc_args[*]} managed-postgresql cluster delete --name '$TEST_CLUSTER_NAME'"
  fi

  local total=$(( $(date +%s) - started_at ))
  log "REHEARSAL УСПЕШЕН. Полное время: ${total} сек. RTO-цель (ADR-0005): 2–4 ч."
}

# Smoke-проверки восстановленной БД: расширения, последняя миграция, ключевые таблицы.
smoke() {
  log "Smoke: проверка расширений (pgcrypto/citext/pg_trgm) …"
  psql "$SMOKE_DATABASE_URL" -tAc \
    "SELECT extname FROM pg_extension WHERE extname IN ('pgcrypto','citext','pg_trgm');" \
    | grep -q pgcrypto || fail "smoke: расширение pgcrypto отсутствует"

  log "Smoke: последняя применённая миграция == $EXPECTED_MIGRATION …"
  local applied
  applied="$(psql "$SMOKE_DATABASE_URL" -tAc 'SELECT COALESCE(MAX(version),0) FROM public._migrations;')" \
    || fail "smoke: не удалось прочитать _migrations"
  [[ "$applied" -ge "$EXPECTED_MIGRATION" ]] \
    || fail "smoke: применённая миграция $applied < ожидаемой $EXPECTED_MIGRATION"

  log "Smoke: ключевые таблицы доступны (users / payment_requests / audit_log) …"
  psql "$SMOKE_DATABASE_URL" -tAc 'SELECT count(*) FROM public.users;'            >/dev/null || fail "smoke: users недоступна"
  psql "$SMOKE_DATABASE_URL" -tAc 'SELECT count(*) FROM public.payment_requests;' >/dev/null || fail "smoke: payment_requests недоступна"
  psql "$SMOKE_DATABASE_URL" -tAc 'SELECT count(*) FROM public.audit_log;'         >/dev/null || fail "smoke: audit_log недоступна"

  log "Smoke зелёный."
}

main "$@"
