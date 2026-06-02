#!/usr/bin/env bash
#
# verify-s3-sync.sh — сверка R2 ⇆ Cloud.ru после миграции файлов (Iteration 9, ADR-0004).
#
# `rclone check --size-only` — НЕ checksum: у multipart-объектов ETag = MD5(конкатенации MD5
# частей)+`-N` и РАЗЛИЧАЕТСЯ между R2 и Cloud.ru при идентичном содержимом (разный chunk-size).
# Поэтому проверка по size (расхождение size = расхождение содержимого) + byte-range audit
# (audit-s3-sample.ts) + manifest count/total (compare-s3-manifests.ts) дают совокупную уверенность.
#
# Принцип 1: только сравнение (read-only на обоих бакетах).
#
# Требования: rclone с remotes `r2:` и `cloudru:`.
#
# Переменные окружения:
#   R2_REMOTE / CLOUDRU_REMOTE   имена rclone-remotes (по умолчанию r2 / cloudru)
#   R2_BUCKET / CLOUDRU_BUCKET   бакеты (по умолчанию billhub-r2 / billhub-s3)
#   CHECKERS                     параллельных checkers (по умолчанию 32)
#   TAG                          суффикс лога (T1 | cutover; по умолчанию T1)
#   DRY_RUN                      1 — печатать команду
#
# Выход: 0 — 0 расхождений; !=0 — найдены расхождения (детали в логе).

set -euo pipefail

log()  { printf '[verify-s3] %s\n' "$*"; }
fail() { printf '[verify-s3][ОШИБКА] %s\n' "$*" >&2; exit 1; }

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/.." && pwd)"
artifacts="$repo_root/docs/cutover-artifacts"
mkdir -p "$artifacts"

R2_REMOTE="${R2_REMOTE:-r2}"
CLOUDRU_REMOTE="${CLOUDRU_REMOTE:-cloudru}"
R2_BUCKET="${R2_BUCKET:-billhub-r2}"
CLOUDRU_BUCKET="${CLOUDRU_BUCKET:-billhub-s3}"
CHECKERS="${CHECKERS:-32}"
TAG="${TAG:-T1}"

command -v rclone >/dev/null 2>&1 || fail "не найден rclone"

src="${R2_REMOTE}:${R2_BUCKET}"
dst="${CLOUDRU_REMOTE}:${CLOUDRU_BUCKET}"
logfile="$artifacts/rclone_check_${TAG}.log"

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  printf '[dry-run] rclone check %s %s --size-only --checkers %s\n' "$src" "$dst" "$CHECKERS"
  exit 0
fi

log "rclone check --size-only $src ⇆ $dst (checkers=$CHECKERS) …"
# rclone check: код возврата !=0, если есть расхождения; вывод дублируем в лог-файл.
if rclone check "$src" "$dst" --size-only --checkers "$CHECKERS" \
     --combined "$artifacts/rclone_check_${TAG}_combined.txt" 2>&1 | tee "$logfile"; then
  log "Расхождений по size НЕ найдено (0 differences). Зелёный."
else
  fail "rclone check нашёл расхождения — см. $logfile и rclone_check_${TAG}_combined.txt"
fi
