#!/usr/bin/env bash
#
# rollback-scenario-b.sh — откат ПОСЛЕ DNS-switch (ADR-0006, Сценарий B). Триггер: smoke в production
# (шаг 11) провалился / всплеск 5xx сразу после переключения. RPO=0 при успешном delta-replay, RTO 15–30 мин.
#
# Действия (ADR-0006 §B):
#   1. Возврат DNS на старую VPS (ручная операция оператора или DNS_REVERT_CMD; TTL 60с, см.
#      10-dns-switch-checklist.md). Скрипт ждёт подтверждения CONFIRM_DNS_REVERTED=1.
#   2. Снятие maintenance со старой VPS (возврат read-write) — как rollback-scenario-a.
#   3. delta-replay: записи Yandex PG с created_at/updated_at > T_DNS_SWITCH → обратно в Supabase
#      через scripts/delta-replay-yandex-to-supabase.ts (ЯВНАЯ операция, НЕ runtime-fallback, принцип 2).
#
# ВНИМАНИЕ: runtime-fallback в Supabase запрещён (split-brain). Это операционная процедура.
#
# Переменные окружения:
#   T_DNS_SWITCH               ISO-метка момента DNS-switch (--since для delta-replay)   [обязательна]
#   SOURCE_URL                 Yandex PG (источник дельты, читается delta-replay)        [обязательна]
#   SUPABASE_URL               Supabase URL (цель delta-replay)                          [обязательна]
#   SUPABASE_SERVICE_ROLE_KEY  service-role key Supabase                                 [обязательна]
#   OLD_VPS_SSH / OLD_BASE_URL + REMOTE_COMPOSE_DIR/COMPOSE_FILE/NGINX_SERVICE/BACKUP_REMOTE  (как в 02)
#   DNS_REVERT_CMD             команда возврата DNS (если есть API); иначе ручной возврат + CONFIRM_DNS_REVERTED=1
#   CONFIRM_DNS_REVERTED       1 — оператор подтвердил, что DNS возвращён на старую VPS
#   DRY_RUN                    1 — печатать план
#
# Выход: 0 — DNS возвращён, старый прод read-write, delta-replay без провалов; !=0 — требуется ручной разбор.

set -euo pipefail

CUTOVER_SCRIPT_NAME="rollback-scenario-b"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"
# shellcheck disable=SC2034
CUTOVER_REPO_ROOT="$repo_root"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/common.sh
source "$here/lib/common.sh"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/nginx-maint.sh
source "$here/lib/nginx-maint.sh"

REMOTE_COMPOSE_DIR="${REMOTE_COMPOSE_DIR:-/opt/portals/billhub}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
NGINX_SERVICE="${NGINX_SERVICE:-nginx}"
BACKUP_REMOTE="${BACKUP_REMOTE:-$REMOTE_COMPOSE_DIR/nginx-default.pre-maintenance.conf}"

step_dns_revert() {
  log "Шаг 1/3: возврат DNS на старую VPS (TTL 60с; см. 10-dns-switch-checklist.md) …"
  if [[ -n "${DNS_REVERT_CMD:-}" ]]; then
    run "$DNS_REVERT_CMD"
    return 0
  fi
  if [[ "$DRY_RUN" == "1" ]]; then log "[dry-run] DNS_REVERT_CMD не задан — ожидалось бы CONFIRM_DNS_REVERTED=1"; return 0; fi
  [[ "${CONFIRM_DNS_REVERTED:-0}" == "1" ]] \
    || fail "DNS НЕ подтверждён как возвращённый. Верните A-запись на старую VPS вручную (TTL 60с) и запустите с CONFIRM_DNS_REVERTED=1 (или задайте DNS_REVERT_CMD)."
  log "  DNS-возврат подтверждён оператором (CONFIRM_DNS_REVERTED=1)."
}

step_old_readwrite() {
  log "Шаг 2/3: снятие maintenance со старой VPS (возврат read-write) …"
  if [[ "$DRY_RUN" == "1" ]]; then log "[dry-run] nm_restore $BACKUP_REMOTE на $OLD_VPS_SSH + verification POST!=503"; return 0; fi
  require_env OLD_VPS_SSH
  require_env OLD_BASE_URL
  if nm_has_marker "$OLD_BASE_URL/"; then
    require_cmd ssh
    nm_restore "$OLD_VPS_SSH" "$REMOTE_COMPOSE_DIR" "$COMPOSE_FILE" "$NGINX_SERVICE" "$BACKUP_REMOTE" \
      || fail "не удалось вернуть старый прод в read-write (нет $BACKUP_REMOTE)"
  else
    log "  Маркера maintenance нет — старый прод уже read-write."
  fi
  local code_post; code_post="$(nm_http_code "$OLD_BASE_URL/api/health" POST)"
  [[ "$code_post" != "503" ]] || fail "старый прод всё ещё read-only (POST=503)"
  log "  ✓ Старый прод принимает запись (POST=$code_post)."
}

step_delta_replay() {
  log "Шаг 3/3: delta-replay Yandex → Supabase (записи после $T_DNS_SWITCH) …"
  if [[ "$DRY_RUN" == "1" ]]; then
    log "[dry-run] npx tsx scripts/delta-replay-yandex-to-supabase.ts --source-url <yandex> --supabase-url <url> --supabase-key *** --since $T_DNS_SWITCH"
    return 0
  fi
  require_cmd npx
  ( cd "$repo_root" && npx tsx scripts/delta-replay-yandex-to-supabase.ts \
      --source-url "$SOURCE_URL" \
      --supabase-url "$SUPABASE_URL" \
      --supabase-key "$SUPABASE_SERVICE_ROLE_KEY" \
      --since "$T_DNS_SWITCH" ) \
    || fail "delta-replay завершился с провалами — см. docs/cutover-artifacts/delta-replay-conflicts.log, разрешите конфликты вручную."
  log "  ✓ delta-replay без провалов (конфликты, если были, — в delta-replay-conflicts.log)."
}

main() {
  init_logging
  require_env T_DNS_SWITCH
  require_env SOURCE_URL
  require_env SUPABASE_URL
  require_env SUPABASE_SERVICE_ROLE_KEY
  require_cmd curl
  assert_not_supabase "$SOURCE_URL" "SOURCE_URL (Yandex)"
  assert_is_supabase "$SUPABASE_URL" "SUPABASE_URL"

  log "=== ROLLBACK B (после DNS-switch): DNS-возврат + старый прод read-write + delta-replay ==="
  log "Принцип 2: runtime-fallback запрещён — это явная операционная процедура (ADR-0006)."

  step_dns_revert
  step_old_readwrite
  step_delta_replay

  log "ГОТОВО. DNS на старой VPS, старый прод read-write, дельта применена обратно в Supabase."
  log "Сверьте счётчики ключевых таблиц Supabase с ожидаемыми. Сообщите пользователям о возврате."
}

main "$@"
