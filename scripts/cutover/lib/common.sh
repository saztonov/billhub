# shellcheck shell=bash
#
# common.sh — общий хелпер скриптов cutover-окна (план Iteration 10, раздел 10).
#
# Источается каждым cutover-скриптом ПОСЛЕ `set -euo pipefail`:
#   CUTOVER_SCRIPT_NAME="01-preflight"
#   source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"
#
# Предоставляет:
#   - log/warn/fail/run            — единый формат вывода + dry-run (run печатает, не выполняет);
#   - require_cmd/require_env       — проверка утилит/переменных (require_cmd мягок в dry-run);
#   - init_logging                  — дублирование всего вывода в /var/log/cutover/<script>.log
#                                     (fallback в repo-local .cutover-logs, если нет прав);
#   - assert_not_supabase/_is_      — guard'ы принципа 1 (цель НЕ Supabase; источник дампа — Supabase);
#   - db_host/mask_url              — извлечение/маскирование секретов в postgres://-URL для логов.
#
# Идемпотентность каждого скрипта обеспечивается им самим (см. шапку конкретного скрипта);
# общий хелпер лишь даёт инструменты (run/маркеры). Двойной source безопасен (guard ниже).

[[ -n "${_CUTOVER_COMMON_SH:-}" ]] && return 0
_CUTOVER_COMMON_SH=1

# Имя скрипта для префикса логов и имени лог-файла. Скрипт может задать CUTOVER_SCRIPT_NAME до source.
CUTOVER_SCRIPT_NAME="${CUTOVER_SCRIPT_NAME:-$(basename "${BASH_SOURCE[1]:-cutover}" .sh)}"
DRY_RUN="${DRY_RUN:-0}"

log()  { printf '[%s] %s\n' "$CUTOVER_SCRIPT_NAME" "$*"; }
warn() { printf '[%s][ПРЕДУПРЕЖДЕНИЕ] %s\n' "$CUTOVER_SCRIPT_NAME" "$*" >&2; }
fail() { printf '[%s][ОШИБКА] %s\n' "$CUTOVER_SCRIPT_NAME" "$*" >&2; exit 1; }

# run: в dry-run печатает команду, не выполняя её (нулевые побочные эффекты — основа idempotency-проверки).
# Вызывается с единственной строкой-командой: run "pg_dump ... -f '$F'". eval "$*" сохраняет кавычки.
run() { if [[ "$DRY_RUN" == "1" ]]; then printf '[dry-run] %s\n' "$*"; else eval "$*"; fi; }

# require_cmd: реальный запуск — hard fail; dry-run — мягкое предупреждение (скрипт остаётся
# запускаемым на машине без операционных утилит pg_dump/rclone/aws/psql/yc/ssh — для idempotency-теста).
require_cmd() {
  if command -v "$1" >/dev/null 2>&1; then return 0; fi
  if [[ "$DRY_RUN" == "1" ]]; then
    warn "утилита '$1' не найдена локально — в реальном запуске обязательна"
    return 0
  fi
  fail "не найдена утилита: $1"
}

require_env() { [[ -n "${!1:-}" ]] || fail "не задана переменная окружения: $1"; }

# Хост из postgres://-URL — для guard принципа 1 и логов без секретов.
db_host() { sed -E 's#^[^@]*@([^:/?]+).*#\1#' <<<"$1"; }

# Маскирование пароля в postgres://user:pass@host для безопасного логирования.
mask_url() { sed -E 's#(://[^:@/]+:)[^@]+@#\1***@#' <<<"$1"; }

# Принцип 1: цель DDL/DML/restore НЕ должна быть Supabase (старый прод не модифицируется).
# Паттерн *supabase.co* покрывает и .co, и .com, и pooler.supabase.com (все содержат подстроку).
assert_not_supabase() {
  local url="$1" label="${2:-URL}"
  case "$url" in
    *supabase.co*)
      [[ "${ALLOW_SUPABASE_MIGRATIONS:-0}" == "1" ]] \
        || fail "$label указывает на Supabase-host ($(db_host "$url")) — отказ (принцип 1: старый прод read-only). Override: ALLOW_SUPABASE_MIGRATIONS=1" ;;
  esac
}

# Источник дампа ДОЛЖЕН быть Supabase (страховка от перепутанных URL — не выгрузить Yandex по ошибке).
assert_is_supabase() {
  local url="$1" label="${2:-URL}"
  case "$url" in
    *supabase.co*) : ;;
    *) warn "$label не похож на Supabase-host ($(db_host "$url")) — проверьте источник дампа." ;;
  esac
}

# Дублирование всего вывода скрипта в лог-файл (+ консоль). Требование плана: «/var/log/cutover/ + stdout».
# /var/log/cutover требует прав root; fallback — repo-local .cutover-logs (gitignored), чтобы dry-run
# на dev-машине не падал и не засорял трекаемые файлы.
init_logging() {
  local dir="${CUTOVER_LOG_DIR:-/var/log/cutover}"
  if ! mkdir -p "$dir" 2>/dev/null; then
    dir="${CUTOVER_REPO_ROOT:-.}/.cutover-logs"
    mkdir -p "$dir" || { printf 'не удалось создать каталог логов\n' >&2; return 0; }
  fi
  CUTOVER_LOG_FILE="$dir/${CUTOVER_SCRIPT_NAME}.log"
  printf '\n===== %s : запуск %s (dry_run=%s) =====\n' \
    "$CUTOVER_SCRIPT_NAME" "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo now)" "$DRY_RUN" \
    >>"$CUTOVER_LOG_FILE" 2>/dev/null || true
  # Весь stdout/stderr → tee (файл + консоль). Требует bash (#!/usr/bin/env bash).
  exec > >(tee -a "$CUTOVER_LOG_FILE") 2>&1
  log "Лог пишется в $CUTOVER_LOG_FILE"
}
