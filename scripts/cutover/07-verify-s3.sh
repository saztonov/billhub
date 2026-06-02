#!/usr/bin/env bash
#
# 07-verify-s3.sh — сверка файлов R2 ⇆ Cloud.ru после финальной дельты (план Iteration 10, шаг 7/12,
# T0+50; ADR-0004). Оркестрирует существующие проверочные скрипты (единый источник логики):
#   1. verify-s3-sync.sh   (TAG=cutover) → rclone check --size-only = 0 расхождений;
#   2. list-r2-manifest.sh (R2 и Cloud.ru, TAG=cutover) → свежие манифесты;
#   3. compare-s3-manifests.ts → count и total_size с допуском ±0.1%.
#
# НЕ checksum (у multipart ETag различается между провайдерами — ADR-0004). Всё read-only (принцип 1).
# Идемпотентно: только чтение/сравнение, повторный запуск перезаписывает те же манифесты/логи.
#
# Переменные окружения:
#   R2_REMOTE/CLOUDRU_REMOTE, R2_BUCKET/CLOUDRU_BUCKET, CHECKERS  → verify-s3-sync.sh
#   R2_ENDPOINT, CLOUDRU_ENDPOINT                                  → list-r2-manifest.sh
#   R2_AWS_PROFILE / CLOUDRU_AWS_PROFILE  профили aws для R2 и Cloud.ru (иначе AWS_PROFILE)
#   DRY_RUN                                1 — печатать намерения
#
# Выход: 0 — size-only 0 расхождений И manifest сошёлся; !=0 — расхождение.

set -euo pipefail

CUTOVER_SCRIPT_NAME="07-verify-s3"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"
# shellcheck disable=SC2034
CUTOVER_REPO_ROOT="$repo_root"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/common.sh
source "$here/lib/common.sh"

ARTIFACTS="$repo_root/docs/cutover-artifacts"
R2_AWS_PROFILE="${R2_AWS_PROFILE:-${AWS_PROFILE:-}}"
CLOUDRU_AWS_PROFILE="${CLOUDRU_AWS_PROFILE:-${AWS_PROFILE:-}}"

main() {
  init_logging
  require_cmd rclone
  log "=== ШАГ 7/12: verify-s3 (rclone check --size-only + manifest), T0+50 ==="

  if [[ "$DRY_RUN" == "1" ]]; then
    log "[dry-run] План:"
    log "  1) verify-s3-sync.sh (TAG=cutover) — rclone check --size-only = 0 расхождений;"
    log "  2) list-r2-manifest.sh SIDE=r2/cloudru (TAG=cutover) — свежие манифесты;"
    log "  3) npx tsx scripts/compare-s3-manifests.ts manifest_r2_cutover.json manifest_cloudru_cutover.json (±0.1%)."
    log "[dry-run] Проверки не выполнялись."
    exit 0
  fi

  # 1. rclone check --size-only (0 расхождений).
  log "1/3: rclone check --size-only (TAG=cutover) …"
  TAG=cutover bash "$repo_root/scripts/verify-s3-sync.sh" \
    || fail "rclone check нашёл расхождения по size — см. docs/cutover-artifacts/rclone_check_cutover.log"

  # 2. Свежие манифесты обеих сторон (момент cutover).
  log "2/3: снимки манифестов R2 и Cloud.ru (TAG=cutover) …"
  SIDE=r2      TAG=cutover AWS_PROFILE="$R2_AWS_PROFILE"      bash "$repo_root/scripts/list-r2-manifest.sh" \
    || fail "не удалось снять manifest R2 (cutover)"
  SIDE=cloudru TAG=cutover AWS_PROFILE="$CLOUDRU_AWS_PROFILE" bash "$repo_root/scripts/list-r2-manifest.sh" \
    || fail "не удалось снять manifest Cloud.ru (cutover)"

  # 3. Сравнение манифестов (count + total_size, допуск ±0.1%).
  log "3/3: compare-s3-manifests.ts (count/total_size ±0.1%) …"
  require_cmd npx
  ( cd "$repo_root" && npx tsx scripts/compare-s3-manifests.ts \
      "$ARTIFACTS/manifest_r2_cutover.json" "$ARTIFACTS/manifest_cloudru_cutover.json" ) \
    || fail "manifest-сравнение не сошлось (count/total_size вне допуска ±0.1%)"

  log "ГОТОВО. Файлы синхронизированы: size-only 0 расхождений + manifest сошёлся. Далее — шаг 8."
}

main "$@"
