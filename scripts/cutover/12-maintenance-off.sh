#!/usr/bin/env bash
#
# 12-maintenance-off.sh — снятие maintenance с НОВОЙ VPS = финальный go-live (план Iteration 10,
# шаг 12/12, T0+95). Запускается ПОСЛЕ зелёного smoke в production (шаг 11).
#
# Семантика: во время окна новая VPS могла отдавать защитную maintenance/landing-страницу на основном
# домене (чтобы трафик, попавший на неё сразу после DNS-switch, не увидел не подтверждённую систему;
# оператор гонит smoke в обход — temp-домен/allowlisted IP). Этот скрипт возвращает прод-конфиг nginx
# (из бэкапа, сохранённого при включении гейта) и подтверждает, что портал live: GET 200 и маркера
# X-BillHub-Maintenance больше нет.
#
# ВАЖНО: скрипт НЕ навязывает свой конфиг (TLS/домен новой VPS специфичны) — только восстанавливает
# ранее сохранённый прод-конфиг из BACKUP_REMOTE. Если гейт не использовался (маркера нет) — идемпотентно
# подтверждает live-состояние и выходит. НЕ трогает старый прод (он остаётся read-only fallback ≥30 дней).
#
# Переменные окружения:
#   NEW_VPS_SSH        ssh-таргет НОВОЙ VPS (user@host)                              [обязательна, если есть гейт]
#   NEW_BASE_URL       URL новой VPS через основной домен (https://billhub.example) [обязательна]
#   REMOTE_COMPOSE_DIR каталог compose на новой VPS (по умолчанию /opt/portals/billhub)
#   COMPOSE_FILE       compose-файл (по умолчанию docker-compose.production.yml)
#   NGINX_SERVICE      имя сервиса nginx (по умолчанию nginx)
#   BACKUP_REMOTE      путь сохранённого прод-конфига (по умолчанию $REMOTE_COMPOSE_DIR/nginx-default.pre-maintenance.conf)
#   DRY_RUN            1 — печатать план, ничего не менять
#
# Выход: 0 — портал live (маркера нет, GET 200); !=0 — ошибка.

set -euo pipefail

CUTOVER_SCRIPT_NAME="12-maintenance-off"
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

verify_live() {
  local base="$1" code
  log "Verification: портал live (GET 200, маркера maintenance нет) …"
  code="$(nm_http_code "$base/api/health" GET)"
  [[ "$code" == "200" ]] || fail "verification: GET /api/health вернул $code (ожидался 200)"
  if nm_has_marker "$base/"; then
    fail "verification: маркер X-BillHub-Maintenance ещё присутствует — гейт не снят."
  fi
  log "  ✓ GET=200, маркера maintenance нет — портал live."
}

main() {
  init_logging
  require_env NEW_BASE_URL
  require_cmd curl
  log "=== ШАГ 12/12: maintenance-OFF новой VPS (go-live), T0+95 ==="

  if [[ "$DRY_RUN" == "1" ]]; then
    log "[dry-run] План:"
    log "  1) детекция X-BillHub-Maintenance на $NEW_BASE_URL;"
    log "  2) если маркер есть → restore прод-конфига из $BACKUP_REMOTE (docker cp + nginx -t + reload);"
    log "  3) если маркера нет → портал уже live, изменений нет;"
    log "  4) verification: GET /api/health=200, маркер отсутствует."
    log "[dry-run] Изменений не внесено."
    exit 0
  fi

  # Идемпотентность: маркера нет → гейт уже снят (или его не было) → только verification.
  if ! nm_has_marker "$NEW_BASE_URL/"; then
    log "Маркер X-BillHub-Maintenance отсутствует — портал уже live (идемпотентный повтор/гейт не использовался)."
    verify_live "$NEW_BASE_URL"
    log "ГОТОВО (без изменений)."
    exit 0
  fi

  require_env NEW_VPS_SSH
  require_cmd ssh
  log "Обнаружен maintenance-гейт — восстановление прод-конфига из $BACKUP_REMOTE …"
  nm_restore "$NEW_VPS_SSH" "$REMOTE_COMPOSE_DIR" "$COMPOSE_FILE" "$NGINX_SERVICE" "$BACKUP_REMOTE" \
    || fail "не удалось восстановить прод-конфиг (нет бэкапа $BACKUP_REMOTE или nginx -t упал). Восстановите конфиг вручную и повторите."

  verify_live "$NEW_BASE_URL"
  log "ГОТОВО. Новая VPS снята с maintenance — портал live на основном домене. Cutover завершён."
}

main "$@"
