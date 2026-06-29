#!/usr/bin/env bash
# Деплой/обновление портала BillHub (build-on-VPS, отклонение §19). Portal-scoped:
# не трогает соседние порталы, infra-nginx и Keycloak. Симлинк /usr/local/bin/deploy-billhub.
#
#   deploy-billhub                 — git pull + сборка образов + перезапуск web/api/worker
#   deploy-billhub --migrate       — то же + накат НОВЫХ миграций (stop worker → migrate → up)
#   deploy-billhub --migrate --maintenance
#                                  — миграции в окне обслуживания (стоп api+worker, для несовместимых
#                                    со старым кодом изменений; по умолчанию политика expand-contract)
#   BRANCH=hotfix deploy-billhub   — деплой другой ветки
#
# Контроли (codex): deploy-lock, immutable commit-SHA теги, pending-migrations guard,
# failure-recovery (trap поднимает прежний worker), лёгкий deployment report.
set -euo pipefail

# ----------------------------------------------------------------------------
# Конфигурация путей и compose.
# ----------------------------------------------------------------------------
SCRIPT="$(readlink -f "$0")"
PORTAL_DIR="$(cd "$(dirname "$SCRIPT")/.." && pwd)"   # корень репо (/opt/portals/billhub)
RUNTIME_ENV=/etc/billhub/runtime.env
COMPOSE_FILE="$PORTAL_DIR/deploy/docker-compose.prod.yml"
COMPOSE=(docker compose -f "$COMPOSE_FILE" -p billhub)

STATE_DIR="${BILLHUB_STATE_DIR:-/var/lib/billhub/deploy}"
LOCK_FILE="$STATE_DIR/deploy.lock"
RELEASE_STATE="$STATE_DIR/release.state"     # current/previous commit-SHA теги
REPORT_DIR="$STATE_DIR/reports"

BRANCH="${BRANCH:-}"
DO_MIGRATE=0
DO_MAINTENANCE=0
for arg in "$@"; do
  case "$arg" in
    --migrate)     DO_MIGRATE=1 ;;
    --maintenance) DO_MAINTENANCE=1 ;;
    *) echo "Неизвестный аргумент: $arg"; exit 2 ;;
  esac
done

log() { echo "==> $*"; }
fail() { echo "ОШИБКА: $*" >&2; exit 1; }

[ -r "$RUNTIME_ENV" ] || fail "Нет доступа к $RUNTIME_ENV (нужны права чтения; см. deploy/README.md)"
mkdir -p "$STATE_DIR" "$REPORT_DIR"

# VITE_API_URL для сборки фронта (same-origin ⇒ обычно пусто). Берём из runtime.env, не падаем если нет.
VITE_API_URL="$(grep -E '^VITE_API_URL=' "$RUNTIME_ENV" 2>/dev/null | head -n1 | cut -d= -f2- || true)"
export VITE_API_URL
VITE_SENTRY_DSN="$(grep -E '^VITE_SENTRY_DSN=' "$RUNTIME_ENV" 2>/dev/null | head -n1 | cut -d= -f2- || true)"
export VITE_SENTRY_DSN

# ----------------------------------------------------------------------------
# Deploy-lock (flock): защита от параллельных запусков. Снимается автоматически с FD.
# ----------------------------------------------------------------------------
exec 9>"$LOCK_FILE"
flock -n 9 || fail "Деплой уже выполняется (lock $LOCK_FILE)."

WORKER_WAS_STOPPED=0
PREV_TAG=""
[ -f "$RELEASE_STATE" ] && PREV_TAG="$(grep -E '^current=' "$RELEASE_STATE" 2>/dev/null | cut -d= -f2- || true)"

# ----------------------------------------------------------------------------
# Failure recovery: если упали после остановки worker — поднять прежний worker.
# ----------------------------------------------------------------------------
RESULT="ok"
REASON=""
recover() {
  local code=$?
  if [ "$code" -ne 0 ]; then
    RESULT="fail"
    [ -z "$REASON" ] && REASON="скрипт прерван (код $code)"
    echo "ОШИБКА деплоя: $REASON" >&2
    if [ "$WORKER_WAS_STOPPED" -eq 1 ]; then
      echo "Recovery: поднимаю прежний worker (откат на BILLHUB_TAG=${PREV_TAG:-latest})..." >&2
      BILLHUB_TAG="${PREV_TAG:-latest}" "${COMPOSE[@]}" up -d billhub-worker || true
    fi
    write_report
  fi
}
trap recover EXIT

write_report() {
  local ts report
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  report="$REPORT_DIR/${ts}-${COMMIT_SHA:-unknown}.json"
  {
    printf '{\n'
    printf '  "portal": "billhub",\n'
    printf '  "environment": "production",\n'
    printf '  "actor": "%s",\n' "${SUDO_USER:-${USER:-unknown}}"
    printf '  "commit": "%s",\n' "${COMMIT_SHA:-unknown}"
    printf '  "image_tag": "%s",\n' "${COMMIT_SHA:-latest}"
    printf '  "previous_tag": "%s",\n' "${PREV_TAG:-}"
    printf '  "migrate": %s,\n' "$DO_MIGRATE"
    printf '  "maintenance": %s,\n' "$DO_MAINTENANCE"
    printf '  "result": "%s",\n' "$RESULT"
    printf '  "reason": "%s"\n' "${REASON//\"/\'}"
    printf '}\n'
  } >"$report"
  log "Отчёт: $report"
}

# ----------------------------------------------------------------------------
# 1. Свежий код.
# ----------------------------------------------------------------------------
log "git pull"
if git -C "$PORTAL_DIR" rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  if [ -n "$BRANCH" ]; then
    git -C "$PORTAL_DIR" fetch --depth 1 origin "$BRANCH"
    git -C "$PORTAL_DIR" checkout -f "$BRANCH"
    git -C "$PORTAL_DIR" reset --hard "origin/$BRANCH"
  else
    git -C "$PORTAL_DIR" pull --ff-only
  fi
else
  log "git upstream не настроен — пропускаю pull"
fi

# Отказ при dirty repo (C4) — образ должен собираться из точного коммита.
if [ -n "$(git -C "$PORTAL_DIR" status --porcelain 2>/dev/null)" ]; then
  REASON="рабочее дерево не чистое (uncommitted changes) — сборка из точного коммита невозможна"
  fail "$REASON"
fi
COMMIT_SHA="$(git -C "$PORTAL_DIR" rev-parse --short HEAD)"
export BILLHUB_TAG="$COMMIT_SHA"
log "commit: $COMMIT_SHA (тег образов billhub-*:$COMMIT_SHA)"

# ----------------------------------------------------------------------------
# 2. Сборка образов с immutable commit-SHA тегом (C-rollback).
# ----------------------------------------------------------------------------
log "build (billhub-api:$COMMIT_SHA, billhub-web:$COMMIT_SHA)"
"${COMPOSE[@]}" build billhub-api billhub-web

# ----------------------------------------------------------------------------
# 3. Pending-migrations guard (C-guard): без --migrate не выкатываем код, требующий новых миграций.
# ----------------------------------------------------------------------------
log "проверка статуса миграций"
MIG_STATUS="$("${COMPOSE[@]}" run --rm migrate node dist/cli/migrate.js status --json 2>/dev/null | tail -n1 || true)"
PENDING="$(printf '%s' "$MIG_STATUS" | grep -oE '"pending":\[[^]]*\]' || true)"
if [ -n "$PENDING" ] && [ "$PENDING" != '"pending":[]' ] && [ "$DO_MIGRATE" -eq 0 ]; then
  REASON="есть непримененные миграции — запустите с --migrate (pending-guard)"
  fail "$REASON"
fi

# ----------------------------------------------------------------------------
# 4. Миграции (только новые) — безопасный порядок C3.
# ----------------------------------------------------------------------------
if [ "$DO_MIGRATE" -eq 1 ]; then
  if [ "$DO_MAINTENANCE" -eq 1 ]; then
    log "окно обслуживания: стоп api+worker (несовместимая миграция)"
    "${COMPOSE[@]}" stop billhub-api billhub-worker || true
    WORKER_WAS_STOPPED=1
  else
    log "stop worker (expand-contract: старый API совместим)"
    "${COMPOSE[@]}" stop billhub-worker || true
    WORKER_WAS_STOPPED=1
  fi
  log "migrate (накат только новых)"
  "${COMPOSE[@]}" run --rm migrate || { REASON="миграция провалилась"; fail "$REASON"; }
fi

# ----------------------------------------------------------------------------
# 5. Обновление сервисов + health.
# ----------------------------------------------------------------------------
log "up -d web/api"
"${COMPOSE[@]}" up -d billhub-web billhub-api

log "health api (/api/health/ready)"
if "${COMPOSE[@]}" exec -T billhub-api wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health/ready; then
  log "health: ok"
else
  log "health: API ещё не готов (проверьте логs/TLS — может быть нормально при первом запуске)"
fi

log "up -d worker"
"${COMPOSE[@]}" up -d billhub-worker
WORKER_WAS_STOPPED=0

# ----------------------------------------------------------------------------
# 6. Release state + отчёт.
# ----------------------------------------------------------------------------
{
  printf 'previous=%s\n' "$PREV_TAG"
  printf 'current=%s\n' "$COMMIT_SHA"
} >"$RELEASE_STATE"

RESULT="ok"
write_report
trap - EXIT
log "Готово: billhub @ $COMMIT_SHA"
