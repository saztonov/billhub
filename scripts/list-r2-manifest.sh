#!/usr/bin/env bash
#
# list-r2-manifest.sh — снимок состояния S3-бакета (manifest) для cutover файлов (Iteration 9, ADR-0004).
#
# Manifest — независимый источник правды для сверки R2 ⇆ Cloud.ru (count + total_size + per-key Size).
# По умолчанию снимает Cloudflare R2 → docs/cutover-artifacts/manifest_r2_T1.json (момент T1).
# Тем же скриптом снимается Cloud.ru после синхронизации (SIDE=cloudru → manifest_cloudru_*.json).
#
# Принцип 1: только list-objects-v2 (read-only). R2 не модифицируется.
#
# Требования: aws CLI (s3api), jq (для total_size summary). Креды берутся из env/aws-профиля.
#
# Переменные окружения:
#   SIDE              r2 | cloudru (по умолчанию r2) — какой бакет снимать
#   R2_ENDPOINT       endpoint Cloudflare R2 (https://<account>.r2.cloudflarestorage.com)  [для SIDE=r2]
#   R2_BUCKET         имя бакета R2 (по умолчанию billhub-r2)
#   CLOUDRU_ENDPOINT  endpoint Cloud.ru S3 (https://s3.cloud.ru)                           [для SIDE=cloudru]
#   CLOUDRU_BUCKET    имя бакета Cloud.ru (по умолчанию billhub-s3)
#   AWS_PROFILE       профиль aws с нужными credentials (R2 или Cloud.ru)
#   OUT_FILE          путь манифеста (по умолчанию docs/cutover-artifacts/manifest_<side>_T1.json)
#   TAG               суффикс момента в имени по умолчанию (T1 | cutover; по умолчанию T1)
#   DRY_RUN           1 — печатать команду, не выполнять
#
# Выход: 0 — манифест записан; печатает count и total_size.

set -euo pipefail

log()  { printf '[manifest] %s\n' "$*"; }
fail() { printf '[manifest][ОШИБКА] %s\n' "$*" >&2; exit 1; }

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/.." && pwd)"
artifacts="$repo_root/docs/cutover-artifacts"

SIDE="${SIDE:-r2}"
TAG="${TAG:-T1}"
R2_BUCKET="${R2_BUCKET:-billhub-r2}"
CLOUDRU_BUCKET="${CLOUDRU_BUCKET:-billhub-s3}"

command -v aws >/dev/null 2>&1 || fail "не найден aws CLI"
mkdir -p "$artifacts"

case "$SIDE" in
  r2)
    [[ -n "${R2_ENDPOINT:-}" ]] || fail "не задан R2_ENDPOINT"
    endpoint="$R2_ENDPOINT"; bucket="$R2_BUCKET" ;;
  cloudru)
    [[ -n "${CLOUDRU_ENDPOINT:-}" ]] || fail "не задан CLOUDRU_ENDPOINT"
    endpoint="$CLOUDRU_ENDPOINT"; bucket="$CLOUDRU_BUCKET" ;;
  *) fail "SIDE должен быть r2 | cloudru (дано: $SIDE)" ;;
esac

OUT_FILE="${OUT_FILE:-$artifacts/manifest_${SIDE}_${TAG}.json}"

log "Снимок бакета '$bucket' ($SIDE, endpoint $endpoint) → $OUT_FILE …"

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  printf '[dry-run] aws s3api list-objects-v2 --endpoint-url %s --bucket %s --query Contents[].{Key,Size,LastModified,ETag} > %s\n' \
    "$endpoint" "$bucket" "$OUT_FILE"
  exit 0
fi

# list-objects-v2 авто-пагинируется AWS CLI; --query применяется ко всему набору.
aws s3api list-objects-v2 \
  --endpoint-url "$endpoint" \
  --bucket "$bucket" \
  --query 'Contents[].{Key:Key, Size:Size, LastModified:LastModified, ETag:ETag}' \
  --output json >"$OUT_FILE" \
  || fail "list-objects-v2 провалился (проверьте endpoint/bucket/credentials)"

# Пустой бакет → aws отдаёт 'null'; нормализуем в [].
if [[ "$(tr -d '[:space:]' <"$OUT_FILE")" == "null" ]]; then printf '[]\n' >"$OUT_FILE"; fi

if command -v jq >/dev/null 2>&1; then
  count="$(jq 'length' "$OUT_FILE")"
  total="$(jq '[.[].Size] | add // 0' "$OUT_FILE")"
  log "Манифест записан: объектов=$count, суммарный размер=$total байт."
else
  log "Манифест записан (jq не найден — count/total посчитает compare-s3-manifests.ts)."
fi
