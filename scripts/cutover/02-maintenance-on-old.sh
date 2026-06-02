#!/usr/bin/env bash
#
# 02-maintenance-on-old.sh — перевод СТАРОГО прода в read-only (план Iteration 10, шаг 2/12, T0+00).
#
# ЕДИНСТВЕННОЕ изменение старого прода за всё время Этапа 1 (жёсткий принцип 1). Механизм — подмена
# nginx-конфига фронтенда на assets/nginx-maintenance.conf (write-методы /api/ → 503, чтение работает),
# БЕЗ деплоя нового кода бэкенда. После cutover старый прод остаётся в read-only ≥30 дней как fallback.
#
# Идемпотентность: при повторном запуске детектирует маркер X-BillHub-Maintenance и НЕ перезатирает
# уже сохранённый оригинал конфига (бэкап делается один раз — нужен для rollback Сценарий A).
#
# Переменные окружения:
#   OLD_VPS_SSH        ssh-таргет старой VPS (user@host)                            [обязательна]
#   OLD_BASE_URL       URL старого прода для verification (https://billhub.example) [обязательна]
#   REMOTE_COMPOSE_DIR каталог compose на старой VPS (по умолчанию /opt/portals/billhub)
#   COMPOSE_FILE       compose-файл (по умолчанию docker-compose.production.yml)
#   NGINX_SERVICE      имя сервиса nginx в compose (по умолчанию nginx)
#   BACKUP_REMOTE      путь бэкапа оригинала на хосте (по умолчанию $REMOTE_COMPOSE_DIR/nginx-default.pre-maintenance.conf)
#   MAINT_CONF         локальный maintenance-конфиг (по умолчанию assets/nginx-maintenance.conf)
#   DRY_RUN            1 — печатать план, ничего не менять
#
# Выход: 0 — старый прод в read-only и verification пройден; !=0 — ошибка.

set -euo pipefail

CUTOVER_SCRIPT_NAME="02-maintenance-on-old"
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
MAINT_CONF="${MAINT_CONF:-$here/assets/nginx-maintenance.conf}"

verify_readonly() {
  local base="$1" code_get code_post
  log "Verification: чтение работает (GET 200), запись запрещена (POST 503), маркер присутствует …"
  code_get="$(nm_http_code "$base/api/health" GET)"
  code_post="$(nm_http_code "$base/api/health" POST)"
  [[ "$code_get" == "200" ]] || fail "verification: GET /api/health вернул $code_get (ожидался 200 — чтение должно работать)"
  [[ "$code_post" == "503" ]] || fail "verification: POST /api/health вернул $code_post (ожидался 503 — запись должна быть запрещена)"
  nm_has_marker "$base/" || warn "verification: маркер X-BillHub-Maintenance не виден в заголовках (проверьте конфиг)"
  log "  ✓ GET=200, POST=503 — старый прод в read-only."
}

main() {
  init_logging
  require_env OLD_VPS_SSH
  require_env OLD_BASE_URL
  require_cmd ssh
  require_cmd curl
  [[ -r "$MAINT_CONF" ]] || fail "не найден maintenance-конфиг: $MAINT_CONF"

  log "=== ШАГ 2/12: maintenance-ON старого прода ($OLD_VPS_SSH) — принцип 1, T0+00 ==="

  if [[ "$DRY_RUN" == "1" ]]; then
    log "[dry-run] План:"
    log "  1) детекция X-BillHub-Maintenance на $OLD_BASE_URL (если уже ON — пропуск swap);"
    log "  2) бэкап активного конфига в $BACKUP_REMOTE (один раз);"
    log "  3) docker cp $MAINT_CONF → nginx:/etc/nginx/conf.d/default.conf; nginx -t; reload;"
    log "  4) verification: GET /api/health=200, POST /api/health=503, маркер присутствует."
    log "[dry-run] Изменений не внесено."
    exit 0
  fi

  # Идемпотентность: если read-only уже включён — повторно не переключаем, только verification.
  if nm_has_marker "$OLD_BASE_URL/"; then
    log "Маркер X-BillHub-Maintenance уже присутствует — старый прод уже в read-only (идемпотентный повтор)."
    verify_readonly "$OLD_BASE_URL"
    log "ГОТОВО (без изменений)."
    exit 0
  fi

  log "Подмена nginx-конфига на maintenance (бэкап оригинала → $BACKUP_REMOTE) …"
  nm_swap "$OLD_VPS_SSH" "$REMOTE_COMPOSE_DIR" "$COMPOSE_FILE" "$NGINX_SERVICE" "$MAINT_CONF" "$BACKUP_REMOTE" \
    || fail "не удалось применить maintenance-конфиг (см. вывод nginx -t выше)"

  verify_readonly "$OLD_BASE_URL"
  log "ГОТОВО. Старый прод переведён в read-only. Оригинал конфига сохранён: $BACKUP_REMOTE (нужен для rollback A)."
}

main "$@"
