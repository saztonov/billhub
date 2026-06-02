#!/usr/bin/env bash
#
# sync-r2-to-cloudru.sh — миграция файлов Cloudflare R2 → Cloud.ru S3 (Iteration 9, ADR-0004).
#
# Два режима:
#   - первичная синхронизация (за 1–2 недели до cutover): `rclone copy` всего корпуса;
#   - финальная дельта (в cutover-окне, FINAL=1): `rclone sync --update` только новых/изменённых.
#
# Принцип 1: R2 — ИСТОЧНИК (read-only). Пишем только в Cloud.ru. Двойная запись на старом проде НЕ делается.
# Verification (size-only + byte-range audit + manifest) — отдельными скриптами verify-s3-sync.sh /
# audit-s3-sample.ts / compare-s3-manifests.ts (НЕ checksum: multipart ETag разные, ADR-0004).
#
# Требования: rclone с настроенными remotes `r2:` и `cloudru:` (rclone.conf, RCLONE_CONFIG).
#
# Переменные окружения:
#   R2_REMOTE         имя rclone-remote источника  (по умолчанию r2)
#   CLOUDRU_REMOTE    имя rclone-remote назначения (по умолчанию cloudru)
#   R2_BUCKET         бакет R2 (по умолчанию billhub-r2)
#   CLOUDRU_BUCKET    бакет Cloud.ru (по умолчанию billhub-s3)
#   TRANSFERS         параллельных передач (по умолчанию 16)
#   CHECKERS          параллельных checkers (по умолчанию 32)
#   S3_CHUNK_SIZE     размер чанка multipart (по умолчанию 16M)
#   FINAL             1 — финальная дельта `rclone sync --update` (cutover-окно)
#   DRY_RUN           1 — rclone --dry-run (печатает, что было бы скопировано)
#
# Выход: код возврата rclone (0 — успех).

set -euo pipefail

log()  { printf '[sync] %s\n' "$*"; }
fail() { printf '[sync][ОШИБКА] %s\n' "$*" >&2; exit 1; }

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/.." && pwd)"
artifacts="$repo_root/docs/cutover-artifacts"
mkdir -p "$artifacts"

R2_REMOTE="${R2_REMOTE:-r2}"
CLOUDRU_REMOTE="${CLOUDRU_REMOTE:-cloudru}"
R2_BUCKET="${R2_BUCKET:-billhub-r2}"
CLOUDRU_BUCKET="${CLOUDRU_BUCKET:-billhub-s3}"
TRANSFERS="${TRANSFERS:-16}"
CHECKERS="${CHECKERS:-32}"
S3_CHUNK_SIZE="${S3_CHUNK_SIZE:-16M}"

command -v rclone >/dev/null 2>&1 || fail "не найден rclone"

src="${R2_REMOTE}:${R2_BUCKET}"
dst="${CLOUDRU_REMOTE}:${CLOUDRU_BUCKET}"

# copy — первичный проход (не удаляет лишнее в назначении);
# sync --update — финальная дельта по mtime+size (только новее/изменённое).
if [[ "${FINAL:-0}" == "1" ]]; then
  subcmd=(sync "$src" "$dst" --update)
  logfile="$artifacts/rclone_sync_cutover.log"
  log "Режим ФИНАЛЬНОЙ ДЕЛЬТЫ (cutover-окно): rclone sync --update."
else
  subcmd=(copy "$src" "$dst")
  logfile="$artifacts/rclone_copy_T1.log"
  log "Режим первичной синхронизации: rclone copy."
fi

args=(
  --transfers "$TRANSFERS"
  --checkers "$CHECKERS"
  --s3-chunk-size "$S3_CHUNK_SIZE"
  --progress
  --stats-one-line
  --log-file "$logfile"
  --log-level INFO
)
[[ "${DRY_RUN:-0}" == "1" ]] && args+=(--dry-run)

log "rclone ${subcmd[0]} $src → $dst (transfers=$TRANSFERS, checkers=$CHECKERS, chunk=$S3_CHUNK_SIZE)"
log "Лог: $logfile"
rclone "${subcmd[@]}" "${args[@]}"
log "Синхронизация завершена. Запустите verify-s3-sync.sh для сверки size-only."
