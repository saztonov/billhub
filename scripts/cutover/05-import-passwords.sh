#!/usr/bin/env bash
#
# 05-import-passwords.sh — финальный перенос bcrypt-хэшей в cutover-окне (план Iteration 10, шаг 5/12,
# T0+35). Обёртка над server/dist/cli/import-passwords.js: читает auth.users.encrypted_password
# (bcrypt) из Supabase (read-only, принцип 1) → public.users.password_hash в Yandex PG, и проверяет
# на выборке (--verify-sample), что перенесённый hash в формате bcrypt ($2a/$2b/$2y). ВАЖНО:
# --verify-sample проверяет ФОРМАТ, а НЕ реальный логин; фактический вход прежним паролем
# подтверждают e2e-smoke на шагах 09/11.
#
# Дополнительно CLI (D1/D3): падает, если пользователь есть в auth.users, но НЕ найден в public.users
# (неполный перенос); печатает список активных пользователей без пароля (им нужен сброс пароля).
#
# Идемпотентность: импорт — UPSERT password_hash по user_id (повторный запуск переносит те же хэши,
# результат тот же). verify-sample случаен, но критерий (все из выборки — валидный bcrypt-формат)
# детерминирован. Если verify-sample/целостность НЕ прошли → выход !=0 → rollback Сценарий A (ADR-0006).
#
# Переменные окружения:
#   SUPABASE_DB_URL          источник bcrypt-хэшей (read-only)                         [обязательна]
#   DATABASE_MIGRATION_URL   цель (Yandex PG, public.users)                            [обязательна]
#   VERIFY_SAMPLE            размер выборки проверки логина (по умолчанию 100)
#   IMPORT_JS                путь к собранному CLI (по умолчанию server/dist/cli/import-passwords.js)
#   DRY_RUN                  1 — печатать команду, не выполнять
#
# Выход: 0 — хэши перенесены и выборка прошла; !=0 — провал (немедленно rollback A).

set -euo pipefail

CUTOVER_SCRIPT_NAME="05-import-passwords"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"
# shellcheck disable=SC2034
CUTOVER_REPO_ROOT="$repo_root"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/common.sh
source "$here/lib/common.sh"

VERIFY_SAMPLE="${VERIFY_SAMPLE:-100}"
IMPORT_JS="${IMPORT_JS:-$repo_root/server/dist/cli/import-passwords.js}"

main() {
  init_logging
  require_env SUPABASE_DB_URL
  require_env DATABASE_MIGRATION_URL
  require_cmd node
  assert_is_supabase "$SUPABASE_DB_URL" "SUPABASE_DB_URL"
  assert_not_supabase "$DATABASE_MIGRATION_URL" "DATABASE_MIGRATION_URL"

  log "=== ШАГ 5/12: import-passwords --verify-sample $VERIFY_SAMPLE, T0+35 ==="

  if [[ "$DRY_RUN" != "1" && ! -f "$IMPORT_JS" ]]; then
    fail "не найден $IMPORT_JS — соберите server: npm --prefix server run build"
  fi

  run "node '$IMPORT_JS' \
    --source-url '$SUPABASE_DB_URL' \
    --target-database-url '$DATABASE_MIGRATION_URL' \
    --verify-sample '$VERIFY_SAMPLE'"

  if [[ "$DRY_RUN" == "1" ]]; then log "[dry-run] Импорт не выполнялся."; exit 0; fi
  log "ГОТОВО. Хэши перенесены, выборка $VERIFY_SAMPLE (формат bcrypt) прошла. Далее — шаг 6 (rclone delta)."
}

main "$@"
