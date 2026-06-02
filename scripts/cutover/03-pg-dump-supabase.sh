#!/usr/bin/env bash
#
# 03-pg-dump-supabase.sh — финальный снимок Supabase в cutover-окне (план Iteration 10, шаг 3/12,
# T0+05; ADR-0003). Делается ПОСЛЕ перевода старого прода в read-only (шаг 2) — поэтому RPO=0
# (новых write нет, дамп содержит все подтверждённые операции, ADR-0005).
#
# pg_dump --data-only -Fc (custom format для параллельного restore -j 4 на шаге 4). Источник —
# Supabase (read-only, принцип 1). Системные auth.* (audit_log_entries/flow_state/refresh_tokens)
# исключаются (migration-inventory §1); bcrypt-хэши переносит отдельно import-passwords (шаг 5).
#
# Идемпотентность: перезаписывает DUMP_FILE свежим снимком (повторный запуск = свежий дамп того же
# read-only состояния). Побочных эффектов на источнике нет (только чтение).
#
# Переменные окружения:
#   SUPABASE_DB_URL   прямое postgres://-подключение к Supabase (источник, read-only)   [обязательна]
#                     формат: postgresql://postgres:***@db.<project>.supabase.co:5432/postgres
#   DUMP_FILE         путь custom-format дампа (по умолчанию ./cutover.dump в корне репо)
#   DRY_RUN           1 — печатать команду, не выполнять
#
# Выход: 0 — дамп создан; !=0 — ошибка.

set -euo pipefail

CUTOVER_SCRIPT_NAME="03-pg-dump-supabase"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"
# shellcheck disable=SC2034
CUTOVER_REPO_ROOT="$repo_root"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/common.sh
source "$here/lib/common.sh"

DUMP_FILE="${DUMP_FILE:-$repo_root/cutover.dump}"

main() {
  init_logging
  require_env SUPABASE_DB_URL
  require_cmd pg_dump
  assert_is_supabase "$SUPABASE_DB_URL" "SUPABASE_DB_URL"

  log "=== ШАГ 3/12: pg_dump --data-only Supabase → $DUMP_FILE (read-only, RPO 0), T0+05 ==="
  log "Источник: $(db_host "$SUPABASE_DB_URL")"

  run "pg_dump '$SUPABASE_DB_URL' \
    --data-only --no-owner --no-privileges \
    --schema=public --schema=auth \
    --exclude-table-data='auth.audit_log_entries' \
    --exclude-table-data='auth.flow_state' \
    --exclude-table-data='auth.refresh_tokens' \
    -Fc -f '$DUMP_FILE'"

  if [[ "$DRY_RUN" == "1" ]]; then log "[dry-run] Дамп не создавался."; exit 0; fi
  [[ -f "$DUMP_FILE" ]] || fail "дамп не создан: $DUMP_FILE"
  local size; size="$(du -h "$DUMP_FILE" 2>/dev/null | cut -f1 || echo '?')"
  log "ГОТОВО. Дамп: $DUMP_FILE (размер: $size). Запишите размер в timeline. Далее — шаг 4 (restore)."
}

main "$@"
