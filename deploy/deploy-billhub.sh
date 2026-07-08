#!/usr/bin/env bash
# Деплой/обновление портала BillHub (build-on-VPS, отклонение §19). Portal-scoped:
# не трогает соседние порталы, infra-nginx и Keycloak. Симлинк /usr/local/bin/deploy-billhub.
#
#   deploy-billhub                 — git pull + сборка образов + перезапуск web/api/worker
#   deploy-billhub --migrate       — то же + дамп БД + накат НОВЫХ миграций (stop worker → dump → migrate → up)
#   deploy-billhub --migrate --maintenance
#                                  — миграции в окне обслуживания (стоп api+worker, для несовместимых
#                                    со старым кодом изменений; по умолчанию политика expand-contract)
#   deploy-billhub --branch=hotfix — деплой другой ветки (эквивалент BRANCH=hotfix deploy-billhub)
#   deploy-billhub --previous      — откат web/api/worker на предыдущий commit-SHA образ (без пересборки);
#                                    current/previous в release.state меняются местами
#   deploy-billhub --restore-db[=файл.dump]
#                                  — восстановление БД из дампа (destructive, интерактивное подтверждение);
#                                    без аргумента — самый свежий дамп; типовой аварийный сценарий после
#                                    неудачной миграции: deploy-billhub --previous --restore-db
#
# Запускать можно от ЛЮБОГО пользователя: скрипт сам перезапустится от владельца
# каталога портала (деплой-пользователь corpsu) через sudo; от самого владельца
# работает напрямую без sudo. Беспарольный запуск от других пользователей —
# drop-in /etc/sudoers.d/billhub-deploy (см. deploy/README.md).
#
# Контроли (codex): deploy-lock, immutable commit-SHA теги, pending-migrations guard,
# failure-recovery (mode-aware), дамп БД перед миграциями (RPO = старт pg_dump),
# атомарный release.state, deployment report с JSON-экранированием.
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
BACKUP_DIR="$STATE_DIR/db-backups"           # дампы БД: ПДн + хэши паролей/токенов — 700/600
DB_TOOLS_IMAGE="postgres:17"                 # мажор = серверу Yandex Managed PG

BRANCH="${BRANCH:-}"
DO_MIGRATE=0
DO_MAINTENANCE=0
DO_PREVIOUS=0
DO_RESTORE=0
RESTORE_FILE_ARG=""
for arg in "$@"; do
  case "$arg" in
    --migrate)      DO_MIGRATE=1 ;;
    --maintenance)  DO_MAINTENANCE=1 ;;
    --branch=*)     BRANCH="${arg#*=}" ;;
    --previous)     DO_PREVIOUS=1 ;;
    --restore-db)   DO_RESTORE=1 ;;
    --restore-db=*) DO_RESTORE=1; RESTORE_FILE_ARG="${arg#*=}" ;;
    *) echo "Неизвестный аргумент: $arg"; exit 2 ;;
  esac
done

log() { echo "==> $*"; }
fail() { echo "ОШИБКА: $*" >&2; exit 1; }

# Режимы отката несовместимы с конвейером сборки/миграций (в т.ч. с env BRANCH).
if [ "$DO_PREVIOUS" -eq 1 ] || [ "$DO_RESTORE" -eq 1 ]; then
  [ "$DO_MIGRATE" -eq 1 ] && fail "--previous/--restore-db несовместимы с --migrate"
  [ "$DO_MAINTENANCE" -eq 1 ] && fail "--previous/--restore-db несовместимы с --maintenance"
  [ -n "$BRANCH" ] && fail "--previous/--restore-db несовместимы с --branch/переменной окружения BRANCH"
fi

# ----------------------------------------------------------------------------
# Самоповышение: деплой должен идти от владельца каталога портала (corpsu).
# От владельца скрипт работает напрямую; от другого пользователя перезапускается
# через sudo. BRANCH передаётся флагом --branch (sudo не пропускает переменные
# окружения). Исходный оператор сохраняется в отчёте (actor) через SUDO_USER.
# Переопределение пользователя: BILLHUB_DEPLOY_USER=<user> deploy-billhub.
# ----------------------------------------------------------------------------
DEPLOY_USER="${BILLHUB_DEPLOY_USER:-$(stat -c %U "$PORTAL_DIR")}"
if [ "$(id -un)" != "$DEPLOY_USER" ]; then
  ELEVATE_ARGS=()
  [ "$DO_MIGRATE" -eq 1 ] && ELEVATE_ARGS+=(--migrate)
  [ "$DO_MAINTENANCE" -eq 1 ] && ELEVATE_ARGS+=(--maintenance)
  [ "$DO_PREVIOUS" -eq 1 ] && ELEVATE_ARGS+=(--previous)
  if [ "$DO_RESTORE" -eq 1 ]; then
    if [ -n "$RESTORE_FILE_ARG" ]; then
      ELEVATE_ARGS+=("--restore-db=$RESTORE_FILE_ARG")
    else
      ELEVATE_ARGS+=(--restore-db)
    fi
  fi
  [ -n "$BRANCH" ] && ELEVATE_ARGS+=("--branch=$BRANCH")
  echo "==> перезапуск от пользователя $DEPLOY_USER (sudo)"
  # ${arr[@]+...} — безопасное раскрытие пустого массива при set -u (bash < 4.4)
  exec sudo -u "$DEPLOY_USER" -H "$SCRIPT" ${ELEVATE_ARGS[@]+"${ELEVATE_ARGS[@]}"}
fi

[ -r "$RUNTIME_ENV" ] || fail "Нет доступа к $RUNTIME_ENV (нужны права чтения; см. deploy/README.md)"
mkdir -p "$STATE_DIR" "$REPORT_DIR"
install -d -m 700 "$BACKUP_DIR"

# Интерполяция compose для сервиса db-tools: контейнер pg_dump/pg_restore работает
# под UID деплой-пользователя (иначе дампы в bind-mount будут root-owned) и монтирует
# каталог бэкапов. Экспорт до первого вызова compose.
BILLHUB_DEPLOY_UID="$(id -u)"
BILLHUB_DEPLOY_GID="$(id -g)"
BILLHUB_BACKUP_DIR="$BACKUP_DIR"
export BILLHUB_DEPLOY_UID BILLHUB_DEPLOY_GID BILLHUB_BACKUP_DIR

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

# Состояние релизов ДО операции (явные имена вместо перегруженного PREV_TAG).
CURRENT_BEFORE=""
PREVIOUS_BEFORE=""
if [ -f "$RELEASE_STATE" ]; then
  CURRENT_BEFORE="$(grep -E '^current=' "$RELEASE_STATE" | cut -d= -f2- || true)"
  PREVIOUS_BEFORE="$(grep -E '^previous=' "$RELEASE_STATE" | cut -d= -f2- || true)"
fi

ACTION="deploy"
[ "$DO_PREVIOUS" -eq 1 ] && ACTION="rollback_previous"
[ "$DO_RESTORE" -eq 1 ] && ACTION="restore_db"
[ "$DO_PREVIOUS" -eq 1 ] && [ "$DO_RESTORE" -eq 1 ] && ACTION="rollback_previous+restore_db"

RESULT="ok"
REASON=""
HEALTH=""
COMMIT_SHA=""
TARGET_TAG=""
REPORT_TAG=""
DUMP_FILE=""
PRE_RESTORE_DUMP=""
WORKER_WAS_STOPPED=0
API_WAS_STOPPED=0
RESTORE_DB_TOUCHED=0     # 1 = pg_restore начал менять БД
ROLLBACK_UP_STARTED=0    # 1 = переключение сервисов на целевой тег начато

# ----------------------------------------------------------------------------
# Вспомогательные функции: JSON-экранирование, отчёт, атомарный release.state,
# health с retry, наличие образа db-tools.
# ----------------------------------------------------------------------------
json_escape() {
  local s=${1//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/\\r}
  s=${s//$'\t'/\\t}
  printf '%s' "$s"
}

write_report() {
  local ts report
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  report="$REPORT_DIR/${ts}-${REPORT_TAG:-unknown}.json"
  {
    printf '{\n'
    printf '  "portal": "billhub",\n'
    printf '  "environment": "production",\n'
    printf '  "action": "%s",\n' "$(json_escape "$ACTION")"
    printf '  "actor": "%s",\n' "$(json_escape "${SUDO_USER:-${USER:-unknown}}")"
    printf '  "commit": "%s",\n' "$(json_escape "$COMMIT_SHA")"
    printf '  "from_tag": "%s",\n' "$(json_escape "$CURRENT_BEFORE")"
    printf '  "to_tag": "%s",\n' "$(json_escape "${TARGET_TAG:-$COMMIT_SHA}")"
    printf '  "previous_tag": "%s",\n' "$(json_escape "$PREVIOUS_BEFORE")"
    printf '  "migrate": %s,\n' "$DO_MIGRATE"
    printf '  "maintenance": %s,\n' "$DO_MAINTENANCE"
    printf '  "dump_file": "%s",\n' "$(json_escape "$DUMP_FILE")"
    printf '  "pre_restore_dump": "%s",\n' "$(json_escape "$PRE_RESTORE_DUMP")"
    printf '  "health": "%s",\n' "$(json_escape "$HEALTH")"
    printf '  "result": "%s",\n' "$RESULT"
    printf '  "reason": "%s"\n' "$(json_escape "$REASON")"
    printf '}\n'
  } >"$report"
  log "Отчёт: $report"
}

# Атомарная запись release.state (tmp + mv под уже взятым flock):
# обрыв в момент записи не должен оставить пустой/битый state.
write_release_state() {
  local prev="$1" cur="$2" tmp
  tmp="$(mktemp "$RELEASE_STATE.XXXXXX")"
  {
    printf 'previous=%s\n' "$prev"
    printf 'current=%s\n' "$cur"
  } >"$tmp"
  mv -f "$tmp" "$RELEASE_STATE"
}

# Диагностический health с retry: результат в $HEALTH и отчёте, деплой/откат не прерывает.
health_check() {
  local i
  HEALTH="fail"
  log "health api (/api/health/ready)"
  for i in 1 2 3 4 5; do
    if "${COMPOSE[@]}" exec -T billhub-api wget --no-verbose --tries=1 --spider \
      http://127.0.0.1:3000/api/health/ready >/dev/null 2>&1; then
      HEALTH="ok"
      log "health: ok"
      return 0
    fi
    sleep 3
  done
  return 1
}

# Образ pg_dump/pg_restore должен быть доступен ДО остановки сервисов:
# внезапный pull из Docker Hub не должен ронять операцию на середине.
ensure_db_tools_image() {
  docker image inspect "$DB_TOOLS_IMAGE" >/dev/null 2>&1 && return 0
  log "docker pull $DB_TOOLS_IMAGE (образ pg_dump/pg_restore)"
  docker pull "$DB_TOOLS_IMAGE" || { REASON="не удалось получить образ $DB_TOOLS_IMAGE"; fail "$REASON"; }
}

# ----------------------------------------------------------------------------
# Failure recovery (mode-aware):
#  - pg_restore прерван — сервисы НЕ поднимаются (разбор вручную);
#  - переключение на целевой тег начато — best-effort вернуть согласованное состояние;
#  - сервисы остановлены, БД не тронута — поднять их на исходном теге.
# ----------------------------------------------------------------------------
recover() {
  local code=$?
  if [ "$code" -ne 0 ]; then
    RESULT="fail"
    [ -z "$REASON" ] && REASON="скрипт прерван (код $code)"
    echo "ОШИБКА ($ACTION): $REASON" >&2
    if [ "$RESTORE_DB_TOUCHED" -eq 1 ]; then
      echo "!! pg_restore прерван. Restore шёл одной транзакцией — скорее всего БД осталась" >&2
      echo "!! в состоянии до restore, но это НУЖНО ПРОВЕРИТЬ вручную. Сервисы ОСТАВЛЕНЫ ОСТАНОВЛЕННЫМИ." >&2
      echo "!! Варианты: повторить deploy-billhub --restore-db=..., pre-restore дамп ($PRE_RESTORE_DUMP), PITR Yandex PG." >&2
    elif [ "$ROLLBACK_UP_STARTED" -eq 1 ]; then
      if [ "$DO_RESTORE" -eq 1 ]; then
        # БД уже восстановлена под целевой тег — повторная попытка поднять именно его
        echo "Recovery: повторная попытка поднять сервисы на теге $TARGET_TAG (БД уже восстановлена)..." >&2
        BILLHUB_TAG="$TARGET_TAG" "${COMPOSE[@]}" up -d --no-build billhub-web billhub-api billhub-worker || true
      else
        # частичный откат кода — вернуть все сервисы на исходный тег, state не переписан
        echo "Recovery: частичное переключение — возвращаю сервисы на исходный тег ${CURRENT_BEFORE:-latest}..." >&2
        BILLHUB_TAG="${CURRENT_BEFORE:-latest}" "${COMPOSE[@]}" up -d --no-build billhub-web billhub-api billhub-worker || true
      fi
    elif [ "$API_WAS_STOPPED" -eq 1 ] || [ "$WORKER_WAS_STOPPED" -eq 1 ]; then
      echo "Recovery: поднимаю остановленные сервисы (BILLHUB_TAG=${CURRENT_BEFORE:-latest})..." >&2
      if [ "$API_WAS_STOPPED" -eq 1 ]; then
        BILLHUB_TAG="${CURRENT_BEFORE:-latest}" "${COMPOSE[@]}" up -d --no-build billhub-api || true
      fi
      BILLHUB_TAG="${CURRENT_BEFORE:-latest}" "${COMPOSE[@]}" up -d --no-build billhub-worker || true
    fi
    write_report
  fi
}
trap recover EXIT

# ============================================================================
# Режимы отката: --previous (код) и/или --restore-db (БД).
# Без git/build/миграций; конвейер сборки ниже не выполняется.
# ============================================================================
if [ "$DO_PREVIOUS" -eq 1 ] || [ "$DO_RESTORE" -eq 1 ]; then
  # --- целевой тег кода ---
  if [ "$DO_PREVIOUS" -eq 1 ]; then
    if [ -z "$PREVIOUS_BEFORE" ]; then
      REASON="в $RELEASE_STATE нет previous= — откатываться не на что"
      fail "$REASON"
    fi
    TARGET_TAG="$PREVIOUS_BEFORE"
    # Образы должны существовать локально: у api/web в compose есть build:, и без
    # этой проверки (+ --no-build ниже) compose мог бы пересобрать тег из текущего дерева.
    for img in "billhub-api:$TARGET_TAG" "billhub-web:$TARGET_TAG"; do
      if ! docker image inspect "$img" >/dev/null 2>&1; then
        REASON="образ $img не найден локально (удалён prune?) — быстрый откат невозможен; пересоберите коммит: deploy-billhub --branch=<ветка>"
        fail "$REASON"
      fi
    done
  else
    TARGET_TAG="${CURRENT_BEFORE:-latest}"
  fi
  REPORT_TAG="$TARGET_TAG"

  log "ВНИМАНИЕ: откат образов НЕ отменяет миграции БД; откат БД — только --restore-db (или PITR Yandex PG)"

  # --- подготовка restore: выбор дампа, guard совместимости, подтверждение ---
  if [ "$DO_RESTORE" -eq 1 ]; then
    if [ -n "$RESTORE_FILE_ARG" ]; then
      # только basename внутри каталога бэкапов; строгий набор символов —
      # имя подставляется в команду контейнера (защита от инъекции)
      if ! printf '%s' "$RESTORE_FILE_ARG" | grep -qE '^[A-Za-z0-9][A-Za-z0-9._-]*\.dump$'; then
        REASON="--restore-db принимает только имя файла *.dump из $BACKUP_DIR (без путей и спецсимволов)"
        fail "$REASON"
      fi
      case "$RESTORE_FILE_ARG" in
        *..*) REASON="--restore-db принимает только имя файла из $BACKUP_DIR"; fail "$REASON" ;;
      esac
      DUMP_FILE="$RESTORE_FILE_ARG"
    else
      # самый свежий деплой-дамп (prerestore-* не рассматриваются)
      LATEST_DUMP="$(ls -1t "$BACKUP_DIR"/[0-9]*.dump 2>/dev/null | head -n1 || true)"
      if [ -z "$LATEST_DUMP" ]; then
        REASON="в $BACKUP_DIR нет дампов (создаются автоматически при deploy-billhub --migrate)"
        fail "$REASON"
      fi
      DUMP_FILE="$(basename "$LATEST_DUMP")"
    fi
    DUMP_PATH="$BACKUP_DIR/$DUMP_FILE"
    if [ ! -f "$DUMP_PATH" ]; then
      REASON="файл дампа не найден: $DUMP_PATH"
      fail "$REASON"
    fi

    META_PATH="${DUMP_PATH%.dump}.meta"
    META_CREATED=""; META_TARGET=""; META_CURRENT_BEFORE=""
    if [ -f "$META_PATH" ]; then
      META_CREATED="$(grep -E '^created_at=' "$META_PATH" | cut -d= -f2- || true)"
      META_TARGET="$(grep -E '^target_commit=' "$META_PATH" | cut -d= -f2- || true)"
      META_CURRENT_BEFORE="$(grep -E '^current_before=' "$META_PATH" | cut -d= -f2- || true)"
    else
      log "ПРЕДУПРЕЖДЕНИЕ: у дампа нет metadata ($META_PATH) — проверка совместимости код/БД невозможна"
    fi

    # Guard совместимости код/БД: standalone restore корректен, только пока код не
    # переключён на новую версию (миграция упала посреди деплоя). Иначе — вместе с --previous.
    if [ "$DO_PREVIOUS" -eq 0 ] && [ -n "$META_CURRENT_BEFORE" ] && [ "$META_CURRENT_BEFORE" != "$CURRENT_BEFORE" ]; then
      REASON="код уже переключён (current=${CURRENT_BEFORE:-пусто}, дамп снят при коде $META_CURRENT_BEFORE) — откатывайте вместе: deploy-billhub --previous --restore-db"
      fail "$REASON"
    fi
    if [ "$DO_PREVIOUS" -eq 1 ] && [ -n "$META_CURRENT_BEFORE" ] && [ "$META_CURRENT_BEFORE" != "$TARGET_TAG" ]; then
      log "ПРЕДУПРЕЖДЕНИЕ: дамп снят при коде $META_CURRENT_BEFORE, а откат кода — на $TARGET_TAG (несоответствие)"
    fi

    ensure_db_tools_image

    echo ""
    echo "  ВОССТАНОВЛЕНИЕ БД ИЗ ДАМПА (destructive)"
    echo "  Файл:                 $DUMP_FILE"
    echo "  Снят (UTC):           ${META_CREATED:-неизвестно}"
    echo "  Перед миграцией на:   ${META_TARGET:-?} (код на момент дампа: ${META_CURRENT_BEFORE:-?})"
    echo "  ВСЕ ДАННЫЕ, записанные в БД после снятия дампа, БУДУТ ПОТЕРЯНЫ."
    printf '  Введите yes для продолжения: '
    read -r CONFIRM || CONFIRM=""
    if [ "$CONFIRM" != "yes" ]; then
      REASON="восстановление БД отменено оператором"
      fail "$REASON"
    fi
  fi

  # --- исполнение restore ---
  if [ "$DO_RESTORE" -eq 1 ]; then
    log "stop api+worker (восстановление БД)"
    "${COMPOSE[@]}" stop billhub-api billhub-worker || true
    API_WAS_STOPPED=1
    WORKER_WAS_STOPPED=1

    # аварийный дамп текущего состояния (без ротации) — страховка от ошибочного подтверждения
    PRE_RESTORE_DUMP="prerestore-$(date -u +%Y%m%dT%H%M%SZ).dump"
    log "pre-restore дамп текущего состояния: db-backups/$PRE_RESTORE_DUMP"
    if ! "${COMPOSE[@]}" run --rm db-tools sh -c \
      "pg_dump --dbname=\"\$DATABASE_MIGRATION_URL\" -Fc -f '/backups/$PRE_RESTORE_DUMP'"; then
      REASON="pre-restore дамп провалился — восстановление НЕ начиналось, БД не тронута"
      fail "$REASON"
    fi
    chmod 600 "$BACKUP_DIR/$PRE_RESTORE_DUMP" || true

    log "pg_restore из $DUMP_FILE (single-transaction, clean)"
    RESTORE_DB_TOUCHED=1
    if ! "${COMPOSE[@]}" run --rm db-tools sh -c \
      "pg_restore --dbname=\"\$DATABASE_MIGRATION_URL\" --single-transaction --exit-on-error --clean --if-exists --no-owner '/backups/$DUMP_FILE'"; then
      REASON="pg_restore провалился"
      fail "$REASON"
    fi
    RESTORE_DB_TOUCHED=0
    log "restore ok (журнал _migrations восстановлен из дампа вместе со схемой)"
  fi

  # --- подъём сервисов на целевом теге (порядок как в обычном деплое) ---
  ROLLBACK_UP_STARTED=1
  log "up -d --no-build web/api (тег $TARGET_TAG)"
  BILLHUB_TAG="$TARGET_TAG" "${COMPOSE[@]}" up -d --no-build billhub-web billhub-api

  health_check || log "health: API не подтвердил готовность (см. логи; операция НЕ прервана)"

  log "up -d --no-build worker (тег $TARGET_TAG)"
  BILLHUB_TAG="$TARGET_TAG" "${COMPOSE[@]}" up -d --no-build billhub-worker
  ROLLBACK_UP_STARTED=0
  API_WAS_STOPPED=0
  WORKER_WAS_STOPPED=0

  # --- state + отчёт ---
  if [ "$DO_PREVIOUS" -eq 1 ]; then
    # swap: state всегда отражает фактически запущенную версию; повторный --previous вернёт обратно
    write_release_state "$CURRENT_BEFORE" "$TARGET_TAG"
    log "release.state: current=$TARGET_TAG previous=$CURRENT_BEFORE"
  fi
  RESULT="ok"
  write_report
  trap - EXIT
  log "Готово ($ACTION): billhub @ $TARGET_TAG"
  exit 0
fi

# ============================================================================
# Обычный деплой.
# ============================================================================

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
TARGET_TAG="$COMMIT_SHA"
REPORT_TAG="$COMMIT_SHA"
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
# 4. Миграции (только новые) — безопасный порядок C3, с полным дампом БД до наката.
# ----------------------------------------------------------------------------
if [ "$DO_MIGRATE" -eq 1 ]; then
  ensure_db_tools_image   # до остановки сервисов

  if [ "$DO_MAINTENANCE" -eq 1 ]; then
    log "окно обслуживания: стоп api+worker (несовместимая миграция)"
    "${COMPOSE[@]}" stop billhub-api billhub-worker || true
    API_WAS_STOPPED=1
    WORKER_WAS_STOPPED=1
  else
    log "stop worker (expand-contract: старый API совместим)"
    "${COMPOSE[@]}" stop billhub-worker || true
    WORKER_WAS_STOPPED=1
  fi

  # Полный дамп до наката. RPO = момент старта pg_dump: в обычном --migrate API
  # продолжает принимать записи (потеряются при restore); при --maintenance API
  # уже остановлен — RPO нулевой. Провал дампа = провал деплоя, миграции не запускаются.
  DUMP_TS="$(date -u +%Y%m%dT%H%M%SZ)"
  DUMP_FILE="${DUMP_TS}-${COMMIT_SHA}.dump"
  log "бэкап БД перед миграциями: pg_dump -Fc → db-backups/$DUMP_FILE"
  if ! "${COMPOSE[@]}" run --rm db-tools sh -c \
    "pg_dump --dbname=\"\$DATABASE_MIGRATION_URL\" -Fc -f '/backups/$DUMP_FILE'"; then
    REASON="дамп БД провалился — миграции не запускались"
    fail "$REASON"
  fi
  chmod 600 "$BACKUP_DIR/$DUMP_FILE" || true

  # metadata дампа — для guard'а совместимости код/БД при --restore-db
  {
    printf 'created_at=%s\n' "$DUMP_TS"
    printf 'target_commit=%s\n' "$COMMIT_SHA"
    printf 'current_before=%s\n' "$CURRENT_BEFORE"
    printf 'migrations_status=%s\n' "$MIG_STATUS"
  } >"$BACKUP_DIR/${DUMP_FILE%.dump}.meta"
  chmod 600 "$BACKUP_DIR/${DUMP_FILE%.dump}.meta" || true

  # ретеншн: 2 последних деплой-дампа (+ их metadata); prerestore-* не ротируются
  ls -1t "$BACKUP_DIR"/[0-9]*.dump 2>/dev/null | tail -n +3 | while read -r old; do
    rm -f "$old" "${old%.dump}.meta"
  done || true

  log "migrate (накат только новых)"
  "${COMPOSE[@]}" run --rm migrate || { REASON="миграция провалилась"; fail "$REASON"; }
fi

# ----------------------------------------------------------------------------
# 5. Обновление сервисов + health.
# ----------------------------------------------------------------------------
log "up -d web/api"
"${COMPOSE[@]}" up -d billhub-web billhub-api
API_WAS_STOPPED=0

health_check || log "health: API ещё не готов (проверьте логи/TLS — может быть нормально при первом запуске)"

log "up -d worker"
"${COMPOSE[@]}" up -d billhub-worker
WORKER_WAS_STOPPED=0

# ----------------------------------------------------------------------------
# 6. Release state + отчёт.
# ----------------------------------------------------------------------------
write_release_state "$CURRENT_BEFORE" "$COMMIT_SHA"

RESULT="ok"
write_report
trap - EXIT
log "Готово: billhub @ $COMMIT_SHA"
