#!/usr/bin/env bash
#
# 08-startup-checks-new.sh — production startup checks на новой VPS (план Iteration 10, шаг 8/12,
# T0+55). Production startup checks (server/src/services/observability/startup-checks.ts) выполняются
# АВТОМАТИЧЕСКИ при старте бэкенда (fail-fast: при проблеме сервис не поднимется). Этот скрипт это
# подтверждает: опционально поднимает стек и ждёт /api/health/ready=200 со всеми зависимостями ok
# (PostgreSQL, migrations==expected, Redis, S3 HEAD bucket).
#
# Идемпотентно: docker compose up -d идемпотентен; основная работа — read-only polling /health/ready.
#
# Переменные окружения:
#   READY_URL          полный URL readiness (по умолчанию $NEW_BASE_URL/api/health/ready)
#   NEW_BASE_URL       база новой VPS (temp-домен на этом шаге, https://temp.billhub.example)
#   BASIC_AUTH         user:pass для basic-auth temp-домена (опционально, curl -u)
#   TIMEOUT_SECONDS    ожидание готовности (по умолчанию 90)
#   BRING_UP           1 — сначала docker compose up -d backend worker на новой VPS (через NEW_VPS_SSH)
#   NEW_VPS_SSH        ssh-таргет новой VPS (нужен при BRING_UP=1)
#   REMOTE_COMPOSE_DIR/COMPOSE_FILE  для BRING_UP (по умолчанию /opt/portals/billhub / docker-compose.production.yml)
#   DRY_RUN            1 — печатать намерения, не выполнять
#
# Выход: 0 — /health/ready=200 со всеми ok; !=0 — не готов в TIMEOUT (startup checks не прошли).

set -euo pipefail

CUTOVER_SCRIPT_NAME="08-startup-checks-new"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"
# shellcheck disable=SC2034
CUTOVER_REPO_ROOT="$repo_root"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/common.sh
source "$here/lib/common.sh"

READY_URL="${READY_URL:-${NEW_BASE_URL:-}/api/health/ready}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-90}"
REMOTE_COMPOSE_DIR="${REMOTE_COMPOSE_DIR:-/opt/portals/billhub}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"

curl_ready() {
  local auth=()
  [[ -n "${BASIC_AUTH:-}" ]] && auth=(-u "$BASIC_AUTH")
  curl -ksS "${auth[@]}" --max-time 10 -w '\n%{http_code}' "$READY_URL"
}

main() {
  init_logging
  require_cmd curl
  [[ -n "$READY_URL" && "$READY_URL" != "/api/health/ready" ]] || fail "не задан READY_URL/NEW_BASE_URL"

  log "=== ШАГ 8/12: production startup checks на новой VPS, T0+55 ==="
  log "Readiness URL: $READY_URL (timeout ${TIMEOUT_SECONDS}с)"

  if [[ "${BRING_UP:-0}" == "1" ]]; then
    require_env NEW_VPS_SSH
    log "BRING_UP=1: docker compose up -d backend worker на новой VPS …"
    if [[ "$DRY_RUN" == "1" ]]; then
      log "[dry-run] ssh $NEW_VPS_SSH 'cd $REMOTE_COMPOSE_DIR && docker compose -f $COMPOSE_FILE up -d backend worker'"
    else
      require_cmd ssh
      ssh -o BatchMode=yes "$NEW_VPS_SSH" "cd '$REMOTE_COMPOSE_DIR' && docker compose -f '$COMPOSE_FILE' up -d backend worker" \
        || fail "docker compose up -d не выполнен на новой VPS"
    fi
  fi

  if [[ "$DRY_RUN" == "1" ]]; then
    log "[dry-run] polling GET $READY_URL до 200 + проверка JSON (database/migrations/redis/s3 = ok)"
    log "[dry-run] Проверки не выполнялись."
    exit 0
  fi

  local deadline body code
  deadline=$(( $(date +%s) + TIMEOUT_SECONDS ))
  while :; do
    body="$(curl_ready 2>/dev/null || true)"
    code="$(printf '%s' "$body" | tail -n1)"
    if [[ "$code" == "200" ]]; then
      # Подтверждаем, что НИ одна зависимость не false (на случай нестандартного 200).
      if printf '%s' "$body" | grep -q '"ok":false'; then
        log "  /health/ready=200, но есть зависимость с ok:false:"; printf '%s\n' "$body" | sed -n '1,$p' | head -c 1000
        fail "startup checks: зависимость не готова (ok:false) — анализ перед продолжением"
      fi
      log "  ✓ /health/ready=200, все зависимости ok (PG/migrations/redis/s3)."
      log "ГОТОВО. Startup checks пройдены. Далее — шаг 9 (smoke на temp-домене)."
      exit 0
    fi
    if (( $(date +%s) >= deadline )); then
      log "  последний ответ (code=$code):"; printf '%s\n' "$body" | head -c 1000
      fail "новый бэкенд не готов за ${TIMEOUT_SECONDS}с (startup checks не прошли или зависимость недоступна)"
    fi
    sleep 3
  done
}

main "$@"
