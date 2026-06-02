#!/usr/bin/env bash
#
# 06-rclone-sync-delta.sh — финальная дельта файлов R2 → Cloud.ru в cutover-окне (план Iteration 10,
# шаг 6/12, T0+40; ADR-0004). Обёртка над scripts/sync-r2-to-cloudru.sh с FINAL=1 (rclone sync
# --update: копирует только новые/изменённые по mtime+size объекты, накопившиеся между T1 и read-only).
#
# Принцип 1: R2 — ИСТОЧНИК (read-only), пишем только в Cloud.ru. ADR-0004: НЕ checksum (у multipart
# ETag различается), сверка size-only + manifest — на шаге 7.
#
# Идемпотентность: rclone sync --update идемпотентен по определению (повторный запуск не копирует
# уже синхронизированное). Делегирование сохраняет единый источник правды логики синхронизации.
#
# Переменные окружения (передаются в sync-r2-to-cloudru.sh):
#   R2_REMOTE/CLOUDRU_REMOTE, R2_BUCKET/CLOUDRU_BUCKET, TRANSFERS, CHECKERS, S3_CHUNK_SIZE
#   DRY_RUN                  1 — rclone --dry-run (печатает, что было бы скопировано)
#
# Выход: код возврата rclone (0 — успех).

set -euo pipefail

CUTOVER_SCRIPT_NAME="06-rclone-sync-delta"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"
# shellcheck disable=SC2034
CUTOVER_REPO_ROOT="$repo_root"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/common.sh
source "$here/lib/common.sh"

SYNC_SH="$repo_root/scripts/sync-r2-to-cloudru.sh"

main() {
  init_logging
  require_cmd rclone
  [[ -x "$SYNC_SH" || -f "$SYNC_SH" ]] || fail "не найден $SYNC_SH"

  log "=== ШАГ 6/12: финальная дельта R2 → Cloud.ru (rclone sync --update), T0+40 ==="
  log "Делегирование в sync-r2-to-cloudru.sh (FINAL=1) — единый источник логики синхронизации."

  if [[ "$DRY_RUN" == "1" ]]; then
    log "[dry-run] FINAL=1 bash scripts/sync-r2-to-cloudru.sh (rclone sync --update R2 → Cloud.ru)"
    log "[dry-run] Делегирование не выполнялось."
    exit 0
  fi

  # FINAL=1 → rclone sync --update (единый источник логики синхронизации, ADR-0004).
  FINAL=1 bash "$SYNC_SH" \
    || fail "rclone sync --update завершился с ошибкой (см. docs/cutover-artifacts/rclone_sync_cutover.log)"

  log "ГОТОВО. Финальная дельта применена. Далее — шаг 7 (verify-s3: rclone check + manifest)."
}

main "$@"
