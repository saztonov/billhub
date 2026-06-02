#!/usr/bin/env bash
#
# rollback-scenario-a.sh — откат ДО DNS-switch (ADR-0006, Сценарий A). Триггер: smoke на новой VPS
# (шаг 9) провалился; production-трафик ещё на старой VPS (в read-only). RPO=0, RTO 5–10 мин.
#
# Действия (ADR-0006 §A): DNS НЕ трогаем; снимаем maintenance со старой VPS (возврат в read-write);
# verification (запись снова работает). Новая VPS разбирается в нерабочем режиме, cutover переносится.
#
# Возврат read-write = восстановление прод-конфига nginx из бэкапа, сохранённого 02-maintenance-on-old.sh
# ($BACKUP_REMOTE). Идемпотентно: если старый прод уже read-write (маркера нет) — только verification.
#
# Переменные окружения:
#   OLD_VPS_SSH        ssh-таргет старой VPS                                            [обязательна]
#   OLD_BASE_URL       URL старого прода для verification (https://billhub.example)     [обязательна]
#   REMOTE_COMPOSE_DIR/COMPOSE_FILE/NGINX_SERVICE/BACKUP_REMOTE  — как в 02-maintenance-on-old.sh
#   DRY_RUN            1 — печатать план
#
# Выход: 0 — старый прод снова read-write и принимает запись; !=0 — ошибка.

set -euo pipefail

CUTOVER_SCRIPT_NAME="rollback-scenario-a"
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

verify_readwrite() {
  local base="$1" code_get code_post
  log "Verification: чтение и ЗАПИСЬ снова работают (POST != 503) …"
  code_get="$(nm_http_code "$base/api/health" GET)"
  [[ "$code_get" == "200" ]] || fail "verification: GET /api/health=$code_get (ожидался 200)"
  code_post="$(nm_http_code "$base/api/health" POST)"
  [[ "$code_post" != "503" ]] || fail "verification: POST /api/health всё ещё 503 — maintenance не снят"
  if nm_has_marker "$base/"; then fail "verification: маркер X-BillHub-Maintenance ещё присутствует"; fi
  log "  ✓ GET=200, POST=$code_post (не 503), маркера нет — старый прод снова read-write."
}

main() {
  init_logging
  require_env OLD_VPS_SSH
  require_env OLD_BASE_URL
  require_cmd curl
  log "=== ROLLBACK A (до DNS-switch): возврат старого прода в read-write ==="
  log "DNS НЕ трогаем — трафик остаётся на старой VPS. ADR-0006 §A. RPO=0."

  if [[ "$DRY_RUN" == "1" ]]; then
    log "[dry-run] План: nm_restore прод-конфига из $BACKUP_REMOTE на $OLD_VPS_SSH + reload; verification POST!=503."
    exit 0
  fi

  if ! nm_has_marker "$OLD_BASE_URL/"; then
    log "Маркера maintenance нет — старый прод уже read-write (идемпотентный повтор)."
    verify_readwrite "$OLD_BASE_URL"
    log "ГОТОВО (без изменений). Сообщите пользователям: cutover отменён, портал работает на старой инфре."
    exit 0
  fi

  require_cmd ssh
  log "Восстановление прод-конфига nginx из $BACKUP_REMOTE (снятие read-only) …"
  nm_restore "$OLD_VPS_SSH" "$REMOTE_COMPOSE_DIR" "$COMPOSE_FILE" "$NGINX_SERVICE" "$BACKUP_REMOTE" \
    || fail "не удалось восстановить прод-конфиг старой VPS (нет $BACKUP_REMOTE или nginx -t упал). Восстановите вручную."

  verify_readwrite "$OLD_BASE_URL"
  log "ГОТОВО. Старый прод снова read-write. Cutover отменён, перепланируйте. Разберите причину провала smoke на новой VPS."
}

main "$@"
