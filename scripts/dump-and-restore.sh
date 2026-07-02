#!/usr/bin/env bash
#
# dump-and-restore.sh — наполнение Yandex Managed PostgreSQL копией prod-данных Supabase
# (план Iteration 9, ADR-0003 «полный pg_dump --data-only + pg_restore», НЕ инкрементальный).
#
# Это генеральная репетиция cutover-процедуры на «момент T1» (за 1–2 недели до окна):
#   1. pg_dump --data-only от Supabase Cloud (read-only — принцип 1, прод не модифицируется).
#   2. pg_restore -j 4 в billhub_db через billhub_migration (схема уже накачена в Iteration 8
#      через bootstrap-schema.sh: schema.sql + 0001/0002/0003).
#   3. Verification:
#      a) count(*) ключевых таблиц Yandex == Supabase (users / payment_requests /
#         contract_requests / payment_request_files);
#      b) pg_dump --schema-only от Yandex даёт набор таблиц = schema.sql + ТОЛЬКО ожидаемые
#         новые таблицы (refresh_tokens, password_reset_tokens, outbox, audit_log*, jobs_log);
#         любое иное расхождение = провал.
#   4. import-passwords.js — перенос bcrypt-хэшей auth.users.encrypted_password → users.password_hash.
#   5. Опциональный idempotent post-restore data-fix 0004_fix_storage_keys.sql (если в R2 легаси-префиксы).
#
# Требования: pg_dump/pg_restore/psql (postgresql-client 15+), node (собранный server), GNU sed/sort/comm.
#
# Переменные окружения:
#   SUPABASE_DB_URL          прямое postgres://-подключение к Supabase (источник дампа, read-only) [обяз.]
#                            формат: postgresql://postgres:***@db.<project>.supabase.co:5432/postgres
#   DATABASE_MIGRATION_URL   billhub_migration к Yandex PG (цель restore + verification + 0004)    [обяз.]
#   SCHEMA_SQL               raw pg_dump схемы Supabase (по умолчанию sql/schema/schema.sql)
#   DUMP_FILE                путь к custom-format дампу (по умолчанию ./cutover_T1.dump)
#   PGSSLROOTCERT            Yandex CA для sslmode=verify-full (psql/pg_restore)
#   VERIFY_SAMPLE            размер выборки для import-passwords --verify-sample (по умолчанию 100)
#   APPLY_STORAGE_KEY_FIX    1 — применить sql/migrations/0004_fix_storage_keys.sql после restore (default 1)
#   SKIP_PASSWORD_IMPORT     1 — пропустить import-passwords (например, повторный прогон)
#   DRY_RUN                  1 — печатать команды, не выполнять
#
# Выход: 0 — наполнение + verification зелёные; !=0 — провал (детали в логе).

set -euo pipefail

log()  { printf '[dump-restore] %s\n' "$*"; }
fail() { printf '[dump-restore][ОШИБКА] %s\n' "$*" >&2; exit 1; }
run()  { if [[ "${DRY_RUN:-0}" == "1" ]]; then printf '[dry-run] %s\n' "$*"; else eval "$@"; fi; }

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/.." && pwd)"

SCHEMA_SQL="${SCHEMA_SQL:-$repo_root/sql/schema/schema.sql}"
DUMP_FILE="${DUMP_FILE:-$repo_root/cutover_T1.dump}"
IMPORT_JS="${IMPORT_JS:-$repo_root/server/dist/cli/import-passwords.js}"
STORAGE_FIX_SQL="${STORAGE_FIX_SQL:-$repo_root/sql/migrations/0004_fix_storage_keys.sql}"
VERIFY_SAMPLE="${VERIFY_SAMPLE:-100}"

# Ключевые таблицы для count-сверки (ADR-0003 «Verification после restore»).
KEY_TABLES=(users payment_requests contract_requests payment_request_files)

# Ожидаемые НОВЫЕ таблицы (отсутствуют в schema.sql, добавлены миграциями 0001/0002).
# audit_log* покрывает партиционированную родительскую + audit_log_default + помесячные.
EXPECTED_NEW=(refresh_tokens password_reset_tokens outbox jobs_log audit_log)

require_cmd() { command -v "$1" >/dev/null 2>&1 || fail "не найдена утилита: $1"; }
require_env() { [[ -n "${!1:-}" ]] || fail "не задана переменная окружения: $1"; }

# Хост из postgres://-URL — для guard принципа 1.
db_host() { sed -E 's#^[^@]*@([^:/?]+).*#\1#' <<<"$1"; }

main() {
  require_cmd pg_dump
  require_cmd pg_restore
  require_cmd psql
  require_cmd sort
  require_cmd comm
  require_env SUPABASE_DB_URL
  require_env DATABASE_MIGRATION_URL
  [[ -f "$SCHEMA_SQL" ]] || fail "не найден SCHEMA_SQL: $SCHEMA_SQL"

  # Принцип 1: цель restore НЕ должна быть Supabase (дублирует assertNotSupabase в runner-е).
  case "$DATABASE_MIGRATION_URL" in
    *supabase.co/*|*supabase.com/*|*pooler.supabase.com/*)
      [[ "${ALLOW_SUPABASE_MIGRATIONS:-0}" == "1" ]] \
        || fail "DATABASE_MIGRATION_URL указывает на Supabase — отказ (принцип 1: цель restore — Yandex PG)." ;;
  esac
  # Источник дампа ДОЛЖЕН быть Supabase (страховка от перепутанных URL).
  case "$SUPABASE_DB_URL" in
    *supabase.co*|*supabase.com*) : ;;
    *) log "ПРЕДУПРЕЖДЕНИЕ: SUPABASE_DB_URL не похож на Supabase-host ($(db_host "$SUPABASE_DB_URL")) — продолжаю." ;;
  esac

  step_dump
  step_drop_fks
  step_restore
  step_readd_fks
  verify_counts
  verify_schema
  step_import_passwords
  step_storage_key_fix

  log "ГОТОВО. Наполнение копией prod-данных + verification зелёные."
}

# FK-определения снятых constraint'ов (между step_drop_fks и step_readd_fks).
FK_DEFS_FILE=""

# --- Шаг 1.5: снять FK-ограничения перед restore -----------------------------
# managed Postgres (Yandex/RDS/Cloud SQL) не даёт суперпользователя, поэтому
# --disable-triggers/session_replication_role=replica недоступны или ненадёжны
# (через connection-pooler в transaction-режиме SET может не сохраняться между
# командами pg_restore). Загружаем данные без FK вообще, проверяем целостность
# при обратном ADD CONSTRAINT (padает с понятной ошибкой, если данные битые).
step_drop_fks() {
  if [[ "${DRY_RUN:-0}" == "1" ]]; then log "Шаг 1.5: снятие FK пропущено (dry-run)."; return; fi
  log "Шаг 1.5: снятие FK-ограничений public.* перед restore (владелец — не требует суперпользователя) …"
  FK_DEFS_FILE="$(mktemp)"
  psql "$DATABASE_MIGRATION_URL" -v ON_ERROR_STOP=on -tAc "
    SELECT 'ALTER TABLE public.' || quote_ident(rel.relname) || ' ADD CONSTRAINT '
           || quote_ident(con.conname) || ' ' || pg_get_constraintdef(con.oid) || ';'
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE con.contype = 'f' AND nsp.nspname = 'public'
  " >"$FK_DEFS_FILE"
  local n; n="$(wc -l <"$FK_DEFS_FILE" | tr -d '[:space:]')"
  psql "$DATABASE_MIGRATION_URL" -v ON_ERROR_STOP=on -tAc "
    SELECT 'ALTER TABLE public.' || quote_ident(rel.relname) || ' DROP CONSTRAINT '
           || quote_ident(con.conname) || ';'
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE con.contype = 'f' AND nsp.nspname = 'public'
  " | psql "$DATABASE_MIGRATION_URL" -v ON_ERROR_STOP=on -q -f -
  log "Снято FK: $n (определения сохранены: $FK_DEFS_FILE)."
}

# --- Шаг 2.5: вернуть FK-ограничения после restore ---------------------------
step_readd_fks() {
  if [[ "${DRY_RUN:-0}" == "1" ]]; then log "Шаг 2.5: возврат FK пропущен (dry-run)."; return; fi
  [[ -n "$FK_DEFS_FILE" && -s "$FK_DEFS_FILE" ]] || { log "Шаг 2.5: нет сохранённых FK — пропуск."; return; }
  log "Шаг 2.5: восстановление FK-ограничений (валидирует целостность перенесённых данных) …"
  psql "$DATABASE_MIGRATION_URL" -v ON_ERROR_STOP=on -q -f "$FK_DEFS_FILE" \
    || fail "не удалось восстановить FK — данные после restore нарушают целостность (см. вывод psql выше)."
  rm -f "$FK_DEFS_FILE"
  log "FK-ограничения восстановлены и провалидированы."
}

# --- Шаг 1: pg_dump --data-only от Supabase (read-only) ---------------------
step_dump() {
  log "Шаг 1/5: pg_dump --data-only от Supabase → $DUMP_FILE (read-only, принцип 1) …"
  # --schema=public + --schema=auth: public-данные + auth.users (для архива/сверки).
  # Исключаем системные Supabase-таблицы auth.* (их не переносим — migration-inventory §1).
  run "pg_dump '$SUPABASE_DB_URL' \
    --data-only --no-owner --no-privileges \
    --schema=public --schema=auth \
    --exclude-table-data='auth.audit_log_entries' \
    --exclude-table-data='auth.flow_state' \
    --exclude-table-data='auth.refresh_tokens' \
    -Fc -f '$DUMP_FILE'"
  [[ "${DRY_RUN:-0}" == "1" || -f "$DUMP_FILE" ]] || fail "дамп не создан: $DUMP_FILE"
  log "Дамп готов."
}

# --- Шаг 2: pg_restore только public-данных в Yandex PG ---------------------
step_restore() {
  # Восстанавливаем ТОЛЬКО public: схемы auth на Yandex нет (sed-фильтр bootstrap её убрал).
  # auth.users в дампе нужен только архивно; bcrypt-хэши берёт import-passwords прямо из Supabase.
  #
  # FK-ограничения сняты в step_drop_fks (managed Postgres не даёт суперпользователя для
  # --disable-triggers; session_replication_role=replica через connection-pooler Yandex (порт 6432,
  # Odyssey в transaction-режиме) на практике не сохраняется между командами pg_restore — проверено).
  # Поэтому -j 4 безопасен независимо от порядка загрузки таблиц.
  log "Шаг 2/5: pg_restore -j 4 --data-only --schema=public в Yandex PG …"
  run "pg_restore --dbname='$DATABASE_MIGRATION_URL' \
    --data-only --no-owner --no-privileges \
    --schema=public -j 4 \
    '$DUMP_FILE' 2> '$repo_root/docs/cutover-artifacts/cutover_db_pg_restore.log' || true"
  # pg_restore может вернуть !=0 на безобидных NOTICE/уже-существующих последовательностях;
  # фактический критерий успеха — verification ниже, а не код возврата restore.
  log "Restore завершён (лог: docs/cutover-artifacts/cutover_db_pg_restore.log). Критерий — verification."
}

# --- Verification 3a: count(*) ключевых таблиц Yandex == Supabase -----------
verify_counts() {
  if [[ "${DRY_RUN:-0}" == "1" ]]; then log "Verification counts пропущена (dry-run)."; return; fi
  log "Шаг 3/5a: сверка count(*) ключевых таблиц (Supabase vs Yandex) …"
  local t src dst
  for t in "${KEY_TABLES[@]}"; do
    src="$(psql "$SUPABASE_DB_URL" -tAc "SELECT count(*) FROM public.$t" | tr -d '[:space:]')" \
      || fail "не удалось прочитать count $t из Supabase"
    dst="$(psql "$DATABASE_MIGRATION_URL" -tAc "SELECT count(*) FROM public.$t" | tr -d '[:space:]')" \
      || fail "не удалось прочитать count $t из Yandex"
    if [[ "$src" != "$dst" ]]; then
      fail "count($t): Supabase=$src != Yandex=$dst — данные перенесены не полностью."
    fi
    log "  ✓ $t: $src == $dst"
  done
  log "Counts сошлись."
}

# Список public BASE TABLE из живой Yandex PG (надёжнее парсинга pg_dump --schema-only).
yandex_tables() {
  psql "$DATABASE_MIGRATION_URL" -tAc \
    "SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_type='BASE TABLE'
     ORDER BY table_name"
}

# Прикладные таблицы из отфильтрованной schema.sql (тот же sed-фильтр, что в bootstrap).
schema_sql_tables() {
  DRY_RUN=1 bash "$here/bootstrap-schema.sh" 2>/dev/null \
    | grep -ioE 'CREATE TABLE (IF NOT EXISTS )?(public\.)?"?[a-z_][a-z0-9_]*"?' \
    | sed -E 's/.* (IF NOT EXISTS )?//; s/public\.//; s/"//g' \
    | sort -u
}

# --- Verification 3b: набор таблиц Yandex = schema.sql + только новые -------
verify_schema() {
  if [[ "${DRY_RUN:-0}" == "1" ]]; then log "Verification schema пропущена (dry-run)."; return; fi
  log "Шаг 3/5b: сверка набора таблиц Yandex == schema.sql + ожидаемые новые …"

  local tmp; tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN

  yandex_tables | sort -u >"$tmp/yandex.txt"
  schema_sql_tables >"$tmp/schema.txt"

  # Ожидаемое множество = таблицы schema.sql + системная _migrations + ожидаемые новые
  # (audit_log плюс его партиции audit_log_* считаем ожидаемыми по префиксу).
  {
    cat "$tmp/schema.txt"
    printf '%s\n' _migrations "${EXPECTED_NEW[@]}"
  } | sort -u >"$tmp/expected.txt"

  # Таблицы Yandex, которых НЕТ в ожидаемом наборе (кроме партиций audit_log_*).
  local unexpected
  unexpected="$(comm -23 "$tmp/yandex.txt" "$tmp/expected.txt" | grep -vE '^audit_log_' || true)"
  # Прикладные таблицы schema.sql, которых НЕ хватает в Yandex (restore/bootstrap неполный).
  local missing
  missing="$(comm -23 "$tmp/schema.txt" "$tmp/yandex.txt" || true)"

  if [[ -n "$missing" ]]; then
    log "ОТСУТСТВУЮТ прикладные таблицы в Yandex:"; printf '  - %s\n' $missing
    fail "набор таблиц Yandex не содержит всех таблиц schema.sql."
  fi
  if [[ -n "$unexpected" ]]; then
    log "НЕОЖИДАННЫЕ таблицы в Yandex (не из schema.sql и не из ожидаемых новых):"
    printf '  - %s\n' $unexpected
    fail "обнаружены расхождения схемы помимо ожидаемых новых таблиц."
  fi

  # Подтверждаем, что каждая ожидаемая новая таблица реально присутствует.
  local nt
  for nt in "${EXPECTED_NEW[@]}"; do
    grep -qx "$nt" "$tmp/yandex.txt" || fail "ожидаемая новая таблица отсутствует: $nt"
  done
  log "Набор таблиц = schema.sql + {${EXPECTED_NEW[*]} (+ партиции audit_log_*)} + _migrations. Расхождений нет."
}

# --- Шаг 4: import-passwords (bcrypt auth.users → users.password_hash) ------
step_import_passwords() {
  if [[ "${SKIP_PASSWORD_IMPORT:-0}" == "1" ]]; then log "Шаг 4/5: import-passwords пропущен (SKIP_PASSWORD_IMPORT=1)."; return; fi
  command -v node >/dev/null 2>&1 || fail "не найден node (нужен для import-passwords)"
  [[ -f "$IMPORT_JS" ]] || fail "не найден $IMPORT_JS (соберите server: npm --prefix server run build)"
  log "Шаг 4/5: import-passwords --verify-sample $VERIFY_SAMPLE …"
  run "node '$IMPORT_JS' \
    --source-url '$SUPABASE_DB_URL' \
    --target-database-url '$DATABASE_MIGRATION_URL' \
    --verify-sample '$VERIFY_SAMPLE'"
  log "Пароли импортированы и проверены выборкой."
}

# --- Шаг 5: idempotent post-restore data-fix ключей S3 (опц.) ---------------
step_storage_key_fix() {
  if [[ "${APPLY_STORAGE_KEY_FIX:-1}" != "1" ]]; then log "Шаг 5/5: 0004_fix_storage_keys пропущен (APPLY_STORAGE_KEY_FIX!=1)."; return; fi
  [[ -f "$STORAGE_FIX_SQL" ]] || { log "Шаг 5/5: $STORAGE_FIX_SQL отсутствует — пропуск."; return; }
  log "Шаг 5/5: применение idempotent 0004_fix_storage_keys.sql после restore (ADR-0004) …"
  run "psql '$DATABASE_MIGRATION_URL' -v ON_ERROR_STOP=on -q -f '$STORAGE_FIX_SQL'"
  log "0004_fix_storage_keys применён (no-op, если легаси-префиксов нет)."
}

main "$@"
